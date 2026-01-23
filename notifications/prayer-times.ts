import z from "zod";
import { Database } from "../types/supabase";
import { supabaseClient } from "../utils/supabase-client";
import { NotificationProtocol, QueueItem } from "./notification-protocol";
import { NotificationCategories, NotificationPayload, NotificationStatuses } from "./notification-types";

const PrayerTimesAPIResponseSchema = z.object({
    current_prayer: z.string(),
    current_prayer_time_elapsed: z.string(),
    upcoming_prayer: z.string(),
    upcoming_prayer_time_left: z.string(),
    local_timezone_id: z.string().optional(),
    times: z.record(z.string(), z.string()),
    times_in_utc: z.record(z.string(), z.string()),
    times_left: z.record(z.string(), z.string())
});

type PrayerTimesAPIResponse = z.infer<typeof PrayerTimesAPIResponseSchema>;

export class PrayerTimesNotification extends NotificationProtocol {

    constructor() {
        super({
            category: NotificationCategories.enum.PRAYER_TIMES
        });
    }

    async start() {
        await this.processLiveQueue(0.1);
        // [Internally update queue for this category]
        await this.updateLiveQueue(0.5);
    }

    async invalidateNotificationDeliveryForQueuedItem(queueItem: QueueItem): Promise<boolean> {
        const { data: recipient } = await supabaseClient()
            .from("ws_push_notifications_users")
            .select("*, prayer_times: ws_push_notifications_registry_prayer_times(*)")
            .eq("device_token", queueItem.device_token)
            .single();

        if (!recipient) return true;
        if (recipient.enabled === false) return true;
        if (!recipient.prayer_times) return true;
        if (recipient.prayer_times.enabled === false) return true;

        return false;
    }

    private async updateLiveQueue(intervalMinutes: number) {

        const fn = async () => {
            const { data: rawRecipients } = await supabaseClient()
                .from("ws_push_notifications_users")
                .select("*, prayer_times: ws_push_notifications_registry_prayer_times(*)")
                .order("created_at", { ascending: false });

            if (!rawRecipients) return;

            // Type narrowing and requirement filter
            const recipients = rawRecipients.filter(
                (r): r is typeof r & {
                    prayer_times: Database['internal']['Tables']['ws_push_notifications_registry_prayer_times']['Row'] & { location: string }
                } => !!r.prayer_times?.location && !!r.prayer_times.enabled && !!r.user_id
            );

            // Group recipients by location preferences to minimize API calls
            const groups = new Map<string, {
                location: string,
                asrAdjustment: boolean,
                users: typeof recipients
            }>();

            for (const r of recipients) {
                const key = `${r.prayer_times.location}_${!!r.prayer_times.afternoon_midpoint_method}`;
                if (!groups.has(key)) {
                    groups.set(key, {
                        location: r.prayer_times.location,
                        asrAdjustment: !!r.prayer_times.afternoon_midpoint_method,
                        users: []
                    });
                }
                groups.get(key)!.users.push(r);
            }

            var i = 1
            for (const [key, group] of groups.entries()) {
                console.log(`[${this.props.category}] === ${group.location} (${i}/${groups.size}) ===`);
                i++;
                const prayerTimes = await this.fetchPrayerTimes(group.location, group.asrAdjustment);
                if (!prayerTimes) continue;

                for (const recipient of group.users) {
                    // [Skip if notification recently sent or currently pending]
                    const { data: existingItem } = await supabaseClient()
                        .from("ws_push_notifications_queue")
                        .select("*")
                        .eq("device_token", recipient.device_token)
                        .eq("category", NotificationCategories.enum.PRAYER_TIMES)
                        .in("status", [NotificationStatuses.enum.DELIVERY_PENDING, NotificationStatuses.enum.DELIVERY_SUCCEEDED])
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (existingItem) {
                        if (existingItem.status === NotificationStatuses.enum.DELIVERY_PENDING) {
                            console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - already pending`);
                            continue;
                        }

                        const time = existingItem.delivered_at || existingItem.created_at;
                        if (new Date(time).getTime() > Date.now() - 1000 * 60 * 60) {
                            console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - notification recently sent`);
                            continue;
                        }
                    }

                    // [Skip if prayer is disabled by user]
                    if (prayerTimes.current_prayer === "fajr" && !recipient.prayer_times.dawn) continue;
                    if (prayerTimes.current_prayer === "sunrise" && !recipient.prayer_times.sunrise) continue;
                    if (prayerTimes.current_prayer === "dhuhr" && !recipient.prayer_times.noon) continue;
                    if (prayerTimes.current_prayer === "asr" && !recipient.prayer_times.afternoon) continue;
                    if (prayerTimes.current_prayer === "maghrib" && !recipient.prayer_times.sunset) continue;
                    if (prayerTimes.current_prayer === "isha" && !recipient.prayer_times.night) continue;

                    // [Skip if > 10m left]
                    // ["10m" = 3 characters, slightly later is okay]
                    if (prayerTimes.upcoming_prayer_time_left.length > 3) {
                        console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - prayer too far away (${prayerTimes.upcoming_prayer_time_left})`);
                        continue;
                    }

                    const payload = this.generateNotificationPayload(recipient.device_token, prayerTimes);

                    // [Add to queue]
                    const { error } = await supabaseClient()
                        .from("ws_push_notifications_queue")
                        .insert({
                            scheduled_time: new Date().toISOString(),
                            device_token: recipient.device_token,
                            status: NotificationStatuses.enum.DELIVERY_PENDING,
                            category: NotificationCategories.enum.PRAYER_TIMES,
                            payload: payload as any // supabase expects Json
                        });

                    if (error) {
                        console.error(`[${this.props.category}] Error adding to queue for ${recipient.device_token}:`, error);
                    }

                    console.log(`[${this.props.category}] Added ${recipient.device_token.slice(0, 5)}... to queue`);
                }
            }
        }

        await fn();

        setInterval(async () => {
            await fn();
        }, 1000 * 60 * intervalMinutes);
    }

    async fetchPrayerTimes(location: string, asrAdjustment: boolean) {
        // [Construct fetch URL]
        const fetchURL = new URL("https://practices.wikisubmission.org/prayer-times/");
        fetchURL.searchParams.set("q", location);
        if (asrAdjustment) {
            fetchURL.searchParams.set("asr_adjustment", "true");
        }

        // [Fetch times]
        const response = await fetch(fetchURL.toString());

        if (!response.ok || response.status !== 200) {
            console.error(`[${this.props.category}] Error fetching times for ${location}`);
            return;
        }

        const rawJson = await response.json();
        const prayerTimes = PrayerTimesAPIResponseSchema.parse(rawJson);

        return prayerTimes;
    }

    generateNotificationPayload(deviceToken: string, prayerTimes: PrayerTimesAPIResponse): z.infer<typeof NotificationPayload> {
        if (prayerTimes.upcoming_prayer === 'sunrise') {
            return {
                deviceToken,
                title: `${prayerTimes.times_left.sunrise} till sunrise`,
                body: `Fajr ends at ${prayerTimes.times.sunrise}`,
                category: NotificationCategories.enum.PRAYER_TIMES,
                deepLink: `wikisubmission://prayer-times`,
                expirationHours: 5
            }
        } else {
            return {
                deviceToken,
                title: `${isFriday(prayerTimes) && prayerTimes.upcoming_prayer === 'dhuhr' ? 'Happy Friday! ' : ''}${prayerTimes.upcoming_prayer_time_left} till ${englishNameForPrayer(prayerTimes.upcoming_prayer)} prayer`,
                body: `${capitalized(prayerTimes.upcoming_prayer)} starts at ${prayerTimes.times[prayerTimes.upcoming_prayer]}`,
                category: NotificationCategories.enum.PRAYER_TIMES,
                deepLink: `wikisubmission://prayer-times`,
                expirationHours: 5
            }
        }
    }
}



function capitalized(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function isFriday(prayerTimes: Pick<PrayerTimesAPIResponse, 'times_in_utc' | 'local_timezone_id'>) {
    try {
        const fajrTimeUTC = prayerTimes.times_in_utc['fajr'];
        if (fajrTimeUTC) {
            const fajrDate = new Date(fajrTimeUTC);
            return fajrDate.toLocaleDateString('en-US', {
                timeZone: prayerTimes.local_timezone_id || 'UTC',
                weekday: 'long'
            }) === 'Friday';
        }
    } catch (_) {
        return false;
    }
    return false;
}

function englishNameForPrayer(prayer: string) {
    const names: Record<string, string> = {
        'fajr': 'dawn',
        'sunrise': 'sunrise',
        'dhuhr': 'noon',
        'asr': 'afternoon',
        'maghrib': 'sunset',
        'sunset': 'sunset',
        'isha': 'night'
    };
    return names[prayer.toLowerCase()] || prayer;
}