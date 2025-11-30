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
            fajr, dhuhr, asr, maghrib, isha,
        } = data.prayer_times_notifications as {
            enabled: boolean | undefined,
            location: string | undefined,
            use_midpoint_method_for_asr: boolean | undefined | undefined,
            fajr: boolean | undefined, dhuhr: boolean | undefined, asr: boolean | undefined, maghrib: boolean | undefined, isha: boolean | undefined
        };

        // Ensure enabled + valid location
        if (enabled === false || !location) {
            return null;
        }

        // Check if prayer times sent within last 1 hour
        if (!force && data.prayer_times_last_delivery_at && !hasTimePassed(data.prayer_times_last_delivery_at, 1, 'hours')) {
            return null;
        }

        // Return prayer times
        const prayerTimesRequest = await fetch(`https://practices.wikisubmission.org/prayer-times/${location}${use_midpoint_method_for_asr ? '?asr_adjustment=true' : ''}`);

        if (!prayerTimesRequest.ok) {
            console.error(`Error getting prayer times`, prayerTimesRequest.statusText);
            throw new Error(prayerTimesRequest.statusText);
        }

        const prayerTimes: {
            status_string: string;
            location_string: string;
            local_time: string;
            times: {
                fajr: string;
                dhuhr: string;
                asr: string;
                maghrib: string;
                isha: string;
                sunrise: string;
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

        // Check if specific prayer disabled
        if (prayerTimes.current_prayer === 'sunrise') return null;
        if (prayerTimes.current_prayer === 'fajr' && !fajr) return null;
        if (prayerTimes.current_prayer === 'dhuhr' && !dhuhr) return null;
        if (prayerTimes.current_prayer === 'asr' && !asr) return null;
        if (prayerTimes.current_prayer === 'maghrib' && !maghrib) return null;
        if (prayerTimes.current_prayer === 'isha' && !isha) return null;

        // Check if starting soon
        if (prayerTimes.upcoming_prayer_time_left === "10m" || prayerTimes.upcoming_prayer_time_left.length === 2) {
            if (prayerTimes.upcoming_prayer === 'sunrise') {
                return {
                    title: `Fajr ending soon!`,
                    body: `Just making sure. You have ${prayerTimes.times_left.sunrise} till it's Sunrise!`,
                    category: 'prayer_times',
                    deepLink: `wikisubmission://prayer-times`,
                    expirationHours: 24
                }
            } else {
                return {
                    title: `${capitalized(prayerTimes.upcoming_prayer)} starting soon!`,
                    body: `${prayerTimes.upcoming_prayer_time_left} left till ${englishNameForPrayer(prayerTimes.upcoming_prayer)} prayer (${prayerTimes.times[prayerTimes.upcoming_prayer]})`,
                    category: 'prayer_times',
                    deepLink: `wikisubmission://prayer-times`,
                    expirationHours: 24
                }
            }
        } else if (force) {
            // Otherwise, return general prayer times
            return {
                title: `Prayer Times`,
                body: `${prayerTimes.status_string} (${prayerTimes.location_string})`,
                category: 'prayer_times',
                deepLink: `wikisubmission://prayer-times`,
                expirationHours: 24
            }
        } else {
            return null;
        }
    }
}

function capitalized(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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