import z from "zod";
import { Database } from "../types/supabase-internal";
import { supabaseInternalClient } from "../utils/supabase-client";
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

    private groupNextCheck = new Map<string, number>();

    constructor() {
        super({
            category: NotificationCategories.enum.PRAYER_TIMES
        });
    }

    async start() {
        // [Internally update queue for this category]
        await this.updateLiveQueue(0.5);
        // [Process queue for this category]
        await this.processLiveQueue(0.1, {
            timeSensitive: {
                maximumMinutesBeforeMarkingAsMissed: 5
            }
        });
    }

    private async updateLiveQueue(intervalMinutes: number) {

        const fn = async () => {
            const { data: rawRecipients } = await supabaseInternalClient()
                .from("ws_push_notifications_users")
                .select("*, prayer_times_registry: ws_push_notifications_registry_prayer_times(*)")
                .eq("enabled", true)
                .eq("prayer_times_registry.enabled", true)
                .order("created_at", { ascending: false });

            if (!rawRecipients) return;

            // Type narrowing and requirement filter
            const recipients = rawRecipients.filter(
                (r): r is typeof r & {
                    prayer_times_registry: Database['internal']['Tables']['ws_push_notifications_registry_prayer_times']['Row'] & { location: string }
                } => !!r.prayer_times_registry?.location && !!r.prayer_times_registry.enabled && !!r.user_id
            );

            // Group recipients by location preferences to minimize API calls
            const groups = new Map<string, {
                location: string,
                asrAdjustment: boolean,
                users: typeof recipients
            }>();

            for (const r of recipients) {
                const key = `${r.prayer_times_registry.location}_${!!r.prayer_times_registry.afternoon_midpoint_method}`;
                if (!groups.has(key)) {
                    groups.set(key, {
                        location: r.prayer_times_registry.location,
                        asrAdjustment: !!r.prayer_times_registry.afternoon_midpoint_method,
                        users: []
                    });
                }
                groups.get(key)!.users.push(r);
            }

            var i = 1
            for (const [key, group] of groups.entries()) {
                const now = Date.now();
                if (this.groupNextCheck.has(key) && now < this.groupNextCheck.get(key)!) {
                    i++;
                    continue;
                }

                console.log(`[${this.props.category}] === ${group.location} (${i}/${groups.size}) ===`);
                i++;
                const prayerTimes = await this.fetchPrayerTimes(group.location, group.asrAdjustment);
                if (!prayerTimes) continue;

                // [Dynamically adjust next check time to avoid redundant API calls]
                const minutesLeft = this.parseTimeLeft(prayerTimes.upcoming_prayer_time_left);
                if (minutesLeft > 15) {
                    const pushMinutes = minutesLeft - 12;
                    console.log(`[${this.props.category}] Skipping... - next prayer (${prayerTimes.upcoming_prayer}) too far away (${prayerTimes.upcoming_prayer_time_left})`);
                    this.groupNextCheck.set(key, now + pushMinutes * 60 * 1000);
                    continue;
                } else {
                    this.groupNextCheck.delete(key);
                }

                for (const recipient of group.users) {
                    // [Skip if notification recently sent or currently pending]
                    const { data: existingItem } = await supabaseInternalClient()
                        .from("ws_push_notifications_queue")
                        .select("*")
                        .eq("device_token", recipient.device_token)
                        .eq("category", NotificationCategories.enum.PRAYER_TIMES)
                        .eq("api_triggered", false)
                        .in("status", [NotificationStatuses.enum.DELIVERY_PENDING, NotificationStatuses.enum.DELIVERY_SUCCEEDED])
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (existingItem) {
                        if (existingItem.status === NotificationStatuses.enum.DELIVERY_PENDING) {
                            console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - already pending`);
                            continue;
                        }

                        // [Skip if notification sent within last 30m]
                        const time = existingItem.delivered_at || existingItem.created_at;
                        if (new Date(time).getTime() > Date.now() - 1000 * 60 * 30) {
                            console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - notification recently sent`);
                            continue;
                        }
                    }

                    // [Skip if prayer is disabled by user]
                    if (prayerTimes.current_prayer === "fajr" && !recipient.prayer_times_registry.dawn) continue;
                    if (prayerTimes.current_prayer === "sunrise" && !recipient.prayer_times_registry.sunrise) continue;
                    if (prayerTimes.current_prayer === "dhuhr" && !recipient.prayer_times_registry.noon) continue;
                    if (prayerTimes.current_prayer === "asr" && !recipient.prayer_times_registry.afternoon) continue;
                    if (prayerTimes.current_prayer === "maghrib" && !recipient.prayer_times_registry.sunset) continue;
                    if (prayerTimes.current_prayer === "isha" && !recipient.prayer_times_registry.night) continue;

                    // [Skip if > '10m' or more left, goal is 10m or under]
                    if (
                        prayerTimes.upcoming_prayer_time_left.length > 2
                        && prayerTimes.upcoming_prayer_time_left !== '10m'
                    ) {
                        console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - prayer too far away (${prayerTimes.upcoming_prayer_time_left})`);
                        continue;
                    }

                    // [Looking good, generate payload]
                    const payload = this.generateNotificationPayload(recipient.device_token, prayerTimes);

                    // [Enqueue the notification with the payload]
                    // [The queue is separately processed and should trigger within a minute]
                    const { error } = await supabaseInternalClient()
                        .from("ws_push_notifications_queue")
                        .insert({
                            scheduled_time: new Date().toISOString(),
                            device_token: recipient.device_token,
                            status: NotificationStatuses.enum.DELIVERY_PENDING,
                            category: NotificationCategories.enum.PRAYER_TIMES,
                            payload: payload as any
                        });

                    if (error) {
                        console.error(`[${this.props.category}] Error adding to queue for ${recipient.device_token}:`, error);
                    }

                    console.log(`[${this.props.category}] Added ${recipient.device_token.slice(0, 5)}... to queue`);

                    await new Promise(resolve => setTimeout(resolve, 150));
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
                expirationHours: 5,
                critical: true
            }
        } else {
            return {
                deviceToken,
                title: `${isFriday(prayerTimes) && prayerTimes.upcoming_prayer === 'dhuhr' ? 'Happy Friday! ' : ''}${prayerTimes.upcoming_prayer_time_left} till ${englishNameForPrayer(prayerTimes.upcoming_prayer)} prayer`,
                body: `${capitalized(prayerTimes.upcoming_prayer)} starts at ${prayerTimes.times[prayerTimes.upcoming_prayer]}`,
                category: NotificationCategories.enum.PRAYER_TIMES,
                deepLink: `wikisubmission://prayer-times`,
                expirationHours: 5,
                critical: true
            }
        }
    }

    private parseTimeLeft(timeLeft: string): number {
        let totalMinutes = 0;
        const hourMatch = timeLeft.match(/(\d+)h/);
        const minuteMatch = timeLeft.match(/(\d+)m/);
        if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
        if (minuteMatch) totalMinutes += parseInt(minuteMatch[1]);
        if (totalMinutes === 0 && timeLeft.length > 0 && !timeLeft.includes('h') && !timeLeft.includes('m')) {
            // Check for just a raw number if applicable
            const rawMatch = timeLeft.match(/(\d+)/);
            if (rawMatch) totalMinutes = parseInt(rawMatch[1]);
        }
        return totalMinutes;
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