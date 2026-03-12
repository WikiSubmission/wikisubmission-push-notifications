import z from "zod";
import { supabaseClient, supabaseInternalClient } from "../utils/supabase-client";
import { NotificationProtocol } from "./notification-protocol";
import { NotificationCategories, NotificationPayload, NotificationStatuses } from "./notification-types";

export class DailyVerseNotification extends NotificationProtocol {

    constructor() {
        super({
            category: NotificationCategories.enum.DAILY_VERSE
        });
    }

    async start() {
        // [Internally update queue for this category]
        await this.updateLiveQueue(240);
        // [Process queue for this category]
        await this.processLiveQueue(300);
    }

    async updateLiveQueue(intervalMinutes: number) {
        const fn = async () => {
            try {
                const { data: recipients, error: recipientsError } = await supabaseInternalClient()
                    .schema("internal")
                    .from("ws_push_notifications_users")
                    .select("*, daily_verse_registry: ws_push_notifications_registry_daily_verse(*)")
                    .eq("enabled", true)
                    .eq("daily_verse_registry.enabled", true)
                    .order("created_at", { ascending: false });

                if (recipientsError) {
                    console.error(`[${this.props.category}] Error fetching recipients:`, recipientsError);
                    return;
                }

                if (!recipients) return;

                console.log(`[${this.props.category}] === Daily Verse Queue ===`)

                for (const recipient of recipients) {
                    try {
                        // [Skip if notification recently sent or currently pending]
                        const { data: existingItem, error: existingItemError } = await supabaseInternalClient()
                            .from("ws_push_notifications_queue")
                            .select("*")
                            .eq("device_token", recipient.device_token)
                            .eq("category", NotificationCategories.enum.DAILY_VERSE)
                            .eq("api_triggered", false)
                            .in("status", [NotificationStatuses.enum.DELIVERY_PENDING, NotificationStatuses.enum.DELIVERY_SUCCEEDED])
                            .order("created_at", { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (existingItemError) {
                            console.error(`[${this.props.category}] Error checking existing items for ${recipient.device_token}:`, existingItemError);
                        }

                        if (existingItem) {
                            if (existingItem.status === NotificationStatuses.enum.DELIVERY_PENDING) {
                                console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - already pending`);
                                continue;
                            }

                            // [Skip if notification sent within last 24h]
                            const time = existingItem.delivered_at || existingItem.created_at;
                            if (new Date(time).getTime() > Date.now() - 1000 * 60 * 60 * 24) {
                                console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - notification recently sent`);
                                continue;
                            }
                        }

                        const dailyVerse = await this.fetchDailyVerse();
                        if (!dailyVerse) {
                            console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - no daily verse found`);
                            continue;
                        }

                        const payload = this.generateNotificationPayload(recipient.device_token, dailyVerse.verseId, dailyVerse.title, dailyVerse.body);

                        // [Enqueue the notification with the payload]
                        // [The queue is separately processed and should trigger within a minute]
                        const { error: insertError } = await supabaseInternalClient()
                            .from("ws_push_notifications_queue")
                            .insert({
                                scheduled_time: new Date().toISOString(),
                                device_token: recipient.device_token,
                                status: NotificationStatuses.enum.DELIVERY_PENDING,
                                category: NotificationCategories.enum.DAILY_VERSE,
                                payload: payload as any
                            });

                        if (insertError) {
                            console.error(`[${this.props.category}] Error adding to queue for ${recipient.device_token}:`, insertError);
                        }

                        await new Promise(resolve => setTimeout(resolve, 400));
                    } catch (err) {
                        console.error(`[${this.props.category}] Unexpected error processing recipient ${recipient.device_token}:`, err);
                    }
                }
            } catch (error) {
                console.error(`[${this.props.category}] Error in updateLiveQueue:`, error);
            }
        }

        const run = async () => {
            await fn();
            setTimeout(run, 1000 * 60 * intervalMinutes);
        }

        await run();
    }

    generateNotificationPayload(deviceToken: string, verseId: string, title: string, body: string): z.infer<typeof NotificationPayload> {
        return {
            deviceToken,
            title,
            body,
            category: this.props.category,
            deepLink: `wikisubmission://quran/verse/${verseId}`,
            expirationHours: 4
        }
    }

    async fetchDailyVerse(): Promise<{ verseId: string, title: string, body: string } | null> {
        try {
            const randomChapter = Math.floor(Math.random() * 114);

            const { data, error } = await supabaseClient()
                .from("ws_quran_index")
                .select("verse_id, chapter:ws_quran_chapters(chapter_number, title_english), text:ws_quran_text(english)")
                .eq("chapter_number", randomChapter)
                .order("verse_number", { ascending: false });

            if (error) {
                console.error(`[${this.props.category}] Error fetching daily verse:`, error);
                return null;
            }

            if (data && data.length > 0) {
                const randomVerse = Math.floor(Math.random() * data.length);
                const verse = data[randomVerse];

                return {
                    verseId: verse.verse_id,
                    title: `Daily Verse`,
                    body: `[${verse.verse_id}] ${verse.text?.english}`
                }
            }
        } catch (error) {
            console.error(`[${this.props.category}] Critical error fetching daily verse:`, error);
        }

        return null;
    }
}