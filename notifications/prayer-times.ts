import { supabaseClient } from "../utils/supabase-client";
import { NotificationProtocol, QueueItem } from "./notification-protocol";
import { NotificationCategories, NotificationPayload, NotificationStatuses } from "./notification-types";
import z from "zod";

export class PrayerTimesNotification extends NotificationProtocol {

    constructor() {
        super({
            category: NotificationCategories.enum.PRAYER_TIMES
        });
    }

    async start() {
        await this.periodicallyCheckAndUpdateQueue(5);
        await this.processQueue(1);
    }

    async getSubscribedUsers() {
        const { data, error } = await supabaseClient()
            .from("ws_push_notifications_users")
            .select("*, prayer_times:ws_push_notifications_registry_prayer_times(*)")
            .order("created_at", { ascending: false })

        if (error) {
            console.error(`[${this.props.category}] Error getting recipients`, error);
            return [];
        }

        return data?.filter(
            i => i.prayer_times?.enabled !== false
        ) || [];
    }

    async periodicallyCheckAndUpdateQueue(intervalMinutes: number) {
        const fn = async () => {
            const recipients = await this.getSubscribedUsers();
            for (const recipient of recipients) {
                if (!recipient.prayer_times || !recipient.prayer_times.location) continue;

                // [Fetch times]
                const prayerTimes = await this.fetchPrayerTimes(recipient.prayer_times.location, recipient.prayer_times.afternoon_midpoint_method === true);

                if (!prayerTimes) continue;

                const queue = await this.getCategoryQueueForUser(recipient.device_token);

                // [Loop over times]
                for (const [prayer, time] of Object.entries(prayerTimes.times_in_utc)) {
                    const scheduledTime = new Date(time);
                    const now = new Date();
                    const diffInMs = scheduledTime.getTime() - now.getTime();

                    // [Ensure time is in future]
                    if (diffInMs <= 0) continue;

                    // [Ensure time is within the next hour]
                    if (diffInMs > 1000 * 60 * 60 * 1) {
                        continue;
                    }

                    // [Ensure no duplicate / redundant queueing]
                    const isAlreadyQueued = queue.some(q => Math.abs(new Date(q.scheduled_time).getTime() - scheduledTime.getTime()) < 5000);
                    if (isAlreadyQueued) {
                        continue;
                    }

                    // [Add to queue]
                    const { data, error } = await supabaseClient()
                        .from("ws_push_notifications_queue")
                        .insert({
                            scheduled_time: scheduledTime.toISOString(),
                            device_token: recipient.device_token,
                            category: NotificationCategories.enum.PRAYER_TIMES,
                            status: NotificationStatuses.enum.DELIVERY_PENDING,
                            payload: this.generateNotificationPayload(recipient.device_token, prayerTimes)
                        })
                        .select("*")
                        .single();

                    if (error) {
                        console.error(`[${this.props.category}] Error queueing notification for ${recipient.prayer_times.location}`, error);
                        continue;
                    }

                    if (data) {
                        console.log(`[${this.props.category}] Queued ${prayer} notification at ${scheduledTime.toLocaleString()} for ${recipient.prayer_times.location}`);
                    }
                }
            }
        }

        await fn();

        setInterval(async () => {
            await fn();
        }, 1000 * 60 * intervalMinutes);
    }

    async shouldCancelNotification(i: QueueItem): Promise<boolean> {
        const { data: recipient } = await supabaseClient()
            .from("ws_push_notifications_users")
            .select("*, prayer_times: ws_push_notifications_registry_prayer_times(*)")
            .eq("device_token", i.device_token)
            .single();

        if (!recipient) return true;
        if (recipient.enabled === false) return true;
        if (!recipient.prayer_times) return true;
        if (recipient.prayer_times.enabled === false) return true;

        return false;
    }

    async getNotificationPayload(i: QueueItem): Promise<z.infer<typeof NotificationPayload> | null> {
        const { data: recipient } = await supabaseClient()
            .from("ws_push_notifications_users")
            .select("*, prayer_times: ws_push_notifications_registry_prayer_times(*)")
            .eq("device_token", i.device_token)
            .single();

        if (!recipient?.prayer_times?.location) return null;

        const prayerTimes = await this.fetchPrayerTimes(recipient.prayer_times.location, recipient.prayer_times.afternoon_midpoint_method === true);

        if (!prayerTimes) return null;

        return this.generateNotificationPayload(recipient.device_token, prayerTimes);
    }

    generateNotificationPayload(deviceToken: string, prayerTimes: PrayerTimesAPIResponse): z.infer<typeof NotificationPayload> | null {
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

        const prayerTimes = await response.json() as PrayerTimesAPIResponse;

        return prayerTimes;
    }
}

interface PrayerTimesAPIResponse {
    current_prayer: 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
    current_prayer_time_elapsed: string;
    upcoming_prayer: 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
    upcoming_prayer_time_left: string;
    times: {
        fajr: string; // e.g. '2026-01-09T12:45:00.000Z'
        sunrise: string;
        dhuhr: string;
        asr: string;
        maghrib: string;
        isha: string;
    };
    times_in_utc: {
        fajr: string; // e.g. '2026-01-09T12:45:00.000Z'
        sunrise: string;
        dhuhr: string;
        asr: string;
        maghrib: string;
        isha: string;
    };
    times_left: {
        fajr: string;
        sunrise: string;
        dhuhr: string;
        asr: string;
        maghrib: string;
        isha: string;
    }
}

function capitalized(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function isFriday(prayerTimes: {
    times_in_utc?: { fajr: string };
    local_timezone_id?: string;
}) {
    try {
        // Use the fajr time in UTC and convert to user's timezone to determine day
        const fajrTimeUTC = prayerTimes.times_in_utc?.fajr;
        if (fajrTimeUTC) {
            const fajrDate = new Date(fajrTimeUTC);
            // Convert to user's timezone and check if it's Friday (5)
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

function englishNameForPrayer(prayer: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha') {
    switch (prayer) {
        case 'fajr':
            return 'dawn';
        case 'dhuhr':
            return 'noon';
        case 'asr':
            return 'afternoon';
        case 'maghrib':
            return 'sunset';
        case 'isha':
            return 'night';
    }
}