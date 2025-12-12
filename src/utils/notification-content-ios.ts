import WikiSubmission from "wikisubmission-sdk";
import { Notification } from "../types/notification";
import { getSupabaseInternalClient } from "./get-supabase-client";
import { hasTimePassed } from "./has-time-passed";
import z from "zod";

export class NotificationContentIOS {
    static shared = new NotificationContentIOS();

    ws = WikiSubmission.createClient();

    async randomVerse(): Promise<z.infer<typeof Notification>['content']> {
        const verse = await this.ws.Quran.randomVerse();
        if (verse.error) {
            console.error(`Error getting random verse`, verse.error);
            throw new Error(verse.error.message);
        }
        return {
            title: `Sura ${verse.data.chapter_number}, ${verse.data.ws_quran_chapters.title_english} (${verse.data.ws_quran_chapters.title_transliterated})`,
            body: `[${verse.data.verse_id}] ${verse.data.ws_quran_text.english}`,
            category: 'random_verse',
            deepLink: `wikisubmission://verse/${verse.data.verse_id}`,
            expirationHours: 5,
            metadata: {
                chapter_number: verse.data.chapter_number,
                verse_id: verse.data.verse_id,
            }
        }
    }

    async verseOfTheDay(deviceToken: string, force: boolean = false): Promise<z.infer<typeof Notification>['content'] | null> {
        const { data, error } = await getSupabaseInternalClient()
            .from('ws_notifications_ios')
            .select('*')
            .eq('device_token', deviceToken)
            .single();

        if (error) {
            console.error(`Error getting verse of the day`, error);
            throw new Error(error.message);
        }

        // Check if daily verse notifications are enabled
        if (!data.daily_verse_notifications) {
            return null;
        }

        // Check if daily verse sent within last 24 hours
        if (!force && data.daily_verse_last_delivery_at && !hasTimePassed(data.daily_verse_last_delivery_at, 24, 'hours')) {
            return null;
        }

        // Return daily verse
        const verse = await this.ws.Quran.randomVerse();

        if (verse.error) {
            console.error(`Error getting verse of the day`, verse.error);
            throw new Error(verse.error.message);
        }

        return {
            title: `Daily Verse`,
            body: `[${verse.data.verse_id}] ${verse.data.ws_quran_text.english}`,
            category: 'daily_verse',
            deepLink: `wikisubmission://verse/${verse.data.verse_id}`,
            expirationHours: 24,
            metadata: {
                chapter_number: verse.data.chapter_number,
                verse_id: verse.data.verse_id,
            }
        }
    }

    async chapterOfTheDay(deviceToken: string, force: boolean = false): Promise<z.infer<typeof Notification>['content'] | null> {
        const { data, error } = await getSupabaseInternalClient()
            .from('ws_notifications_ios')
            .select('*')
            .eq('device_token', deviceToken)
            .single();

        if (error) {
            console.error(`Error getting chapter of the day`, error);
            throw new Error(error.message);
        }

        // Check if daily chapter notifications are enabled
        if (!data.daily_chapter_notifications) {
            return null;
        }

        // Check if daily chapter sent within last 24 hours
        if (!force && data.daily_chapter_last_delivery_at && !hasTimePassed(data.daily_chapter_last_delivery_at, 24, 'hours')) {
            return null;
        }

        // Return daily chapter
        const chapter = await this.ws.Quran.randomVerse();

        if (chapter.error) {
            console.error(`Error getting chapter of the day`, chapter.error);
            throw new Error(chapter.error.message);
        }

        return {
            title: `Daily Chapter`,
            body: `Sura ${chapter.data.chapter_number}, ${chapter.data.ws_quran_chapters.title_english} (${chapter.data.ws_quran_chapters.title_transliterated}). Click to read now.`,
            category: 'daily_chapter',
            deepLink: `wikisubmission://chapter/${chapter.data.chapter_number}`,
            expirationHours: 24,
            metadata: {
                chapter_number: chapter.data.chapter_number,
                verse_id: `${chapter.data.chapter_number}:1`,
            }
        }
    }

    async prayerTimes(deviceToken: string, force: boolean = false): Promise<z.infer<typeof Notification>['content'] | null> {
        const { data, error } = await getSupabaseInternalClient()
            .from('ws_notifications_ios')
            .select('*')
            .eq('device_token', deviceToken)
            .single();

        if (error) {
            console.error(`Error getting prayer times`, error);
            throw new Error(error.message);
        }

        // Check if prayer times notifications are enabled
        if (!data.prayer_times_notifications) {
            return null;
        }

        // Check user settings
        const {
            enabled,
            location,
            use_midpoint_method_for_asr,
            fajr, dhuhr, asr, maghrib, isha, sunrise
        } = data.prayer_times_notifications as {
            enabled: boolean | undefined,
            location: string | undefined,
            use_midpoint_method_for_asr: boolean | undefined | undefined,
            fajr: boolean | undefined, dhuhr: boolean | undefined, asr: boolean | undefined, maghrib: boolean | undefined, isha: boolean | undefined, sunrise: boolean | undefined
        };

        // Ensure enabled + valid location
        if (enabled === false || !location) {
            return null;
        }

        // Check if prayer times sent within last half hour
        if (!force && data.prayer_times_last_delivery_at && !hasTimePassed(data.prayer_times_last_delivery_at, 30, 'minutes')) {
            return null;
        }

        // Return prayer times (with timeout and retry)
        const prayerTimesUrl = `https://practices.wikisubmission.org/prayer-times/${location}${use_midpoint_method_for_asr ? '?asr_adjustment=true' : ''}`;

        let prayerTimesRequest: Response | null = null;
        let lastError: Error | null = null;

        // Retry up to 3 times with increasing delays
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

                prayerTimesRequest = await fetch(prayerTimesUrl, {
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (prayerTimesRequest.ok) {
                    break; // Success, exit retry loop
                }

                lastError = new Error(prayerTimesRequest.statusText);
            } catch (err: any) {
                lastError = err;
                console.error(`Prayer times fetch attempt ${attempt} failed:`, err.message);

                // Wait before retrying (exponential backoff: 1s, 2s, 4s)
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
                }
            }
        }

        if (!prayerTimesRequest || !prayerTimesRequest.ok) {
            console.error(`Error getting prayer times after 3 attempts`, lastError?.message);
            throw new Error(lastError?.message || 'Failed to fetch prayer times');
        }

        const prayerTimes: {
            status_string: string;
            location_string: string;
            local_time: string;
            local_timezone_id?: string;
            times: {
                fajr: string;
                dhuhr: string;
                asr: string;
                maghrib: string;
                isha: string;
                sunrise: string;
            }
            times_in_utc?: {
                fajr: string;
                dhuhr: string;
                asr: string;
                maghrib: string;
                isha: string;
                sunrise: string;
                sunset: string;
            }
            times_left: {
                fajr: string;
                dhuhr: string;
                asr: string;
                maghrib: string;
                isha: string;
                sunrise: string;
            }
            current_prayer: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha' | 'sunrise';
            upcoming_prayer: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha' | 'sunrise';
            current_prayer_time_elapsed: string;
            upcoming_prayer_time_left: string;
        } = await prayerTimesRequest.json();

        // Check if starting soon
        if (
            prayerTimes.upcoming_prayer_time_left === "10m" ||
            prayerTimes.upcoming_prayer_time_left.length === 2
        ) {
            // Check if specific prayer notification is disabled by user
            if (!force) {
                if (prayerTimes.upcoming_prayer === 'sunrise' && sunrise === false) return null;
                if (prayerTimes.upcoming_prayer === 'fajr' && fajr === false) return null;
                if (prayerTimes.upcoming_prayer === 'dhuhr' && dhuhr === false) return null;
                if (prayerTimes.upcoming_prayer === 'asr' && asr === false) return null;
                if (prayerTimes.upcoming_prayer === 'maghrib' && maghrib === false) return null;
                if (prayerTimes.upcoming_prayer === 'isha' && isha === false) return null;
            }

            if (prayerTimes.upcoming_prayer === 'sunrise') {
                return {
                    title: `${prayerTimes.times_left.sunrise} till sunrise`,
                    body: `Fajr ends at ${prayerTimes.times.sunrise}`,
                    category: 'prayer_times',
                    deepLink: `wikisubmission://prayer-times`,
                    expirationHours: 12
                }
            } else {
                return {
                    title: `${isFriday(prayerTimes) && prayerTimes.upcoming_prayer === 'dhuhr' ? 'Happy Friday! ' : ''}${prayerTimes.upcoming_prayer_time_left} till ${englishNameForPrayer(prayerTimes.upcoming_prayer)} prayer`,
                    body: `${capitalized(prayerTimes.upcoming_prayer)} starts at ${prayerTimes.times[prayerTimes.upcoming_prayer]}`,
                    category: 'prayer_times',
                    deepLink: `wikisubmission://prayer-times`,
                    expirationHours: 12
                }
            }
        } else if (force) {
            // Otherwise, return general prayer times
            return {
                title: `${prayerTimes.status_string}`,
                body: `${prayerTimes.location_string}`,
                category: 'prayer_times',
                deepLink: `wikisubmission://prayer-times`,
                expirationHours: 12
            }
        } else {
            return null;
        }
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
    } catch (error) {
        console.warn('Error determining day of week:', error);
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