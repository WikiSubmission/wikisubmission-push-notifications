import z from "zod";
import { supabaseClient, supabaseInternalClient } from "../utils/supabase-client";
import { NotificationProtocol } from "./notification-protocol";
import { NotificationCategories, NotificationPayload, NotificationStatuses } from "./notification-types";
import { logger } from "../utils/logger";

export class DailyVerseNotification extends NotificationProtocol {

    constructor() {
        super({
            category: NotificationCategories.enum.DAILY_VERSE
        });
    }

    async start() {
        // [Internally update queue for this category]
        await this.updateLiveQueue(120);
        // [Process queue for this category]
        await this.processLiveQueue(120, {
            timeSensitive: {
                maximumMinutesBeforeMarkingAsMissed: 4 * 60
            },
            orderOldestFirst: true
        });
    }

    async updateLiveQueue(intervalMinutes: number) {
        const fn = async () => {
            try {
                const { data: recipients, error: recipientsError } = await supabaseInternalClient()
                    .schema("internal")
                    .from("ws_push_notifications_users")
                    .select("device_token, random_verse_registry: ws_push_notifications_registry_random_verse(enabled)")
                    .eq("enabled", true)
                    .eq("random_verse_registry.enabled", true)
                    .order("created_at", { ascending: false });

                if (recipientsError) {
                    logger.error(`[${this.props.category}] Error fetching recipients`, recipientsError);
                    return;
                }

                if (!recipients) return;

                logger.info(`[${this.props.category}] === Daily Verse Queue — ${recipients.length} recipient(s) ===`)

                // [Batch-fetch recent queue items for all recipients]
                const allTokens = recipients.map(r => r.device_token);
                const since48h = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString();
                const { data: batchExisting, error: batchError } = await supabaseInternalClient()
                    .from("ws_push_notifications_queue")
                    .select("device_token, status, delivered_at, created_at")
                    .in("device_token", allTokens)
                    .eq("category", NotificationCategories.enum.DAILY_VERSE)
                    .eq("api_triggered", false)
                    .in("status", [NotificationStatuses.enum.DELIVERY_PENDING, NotificationStatuses.enum.DELIVERY_SUCCEEDED])
                    .gte("created_at", since48h)
                    .order("created_at", { ascending: false });

                if (batchError) {
                    logger.error(`[${this.props.category}] Error batch-fetching queue items`, batchError);
                }

                const recentQueueByToken = new Map<string, NonNullable<typeof batchExisting>[0]>();
                for (const item of batchExisting ?? []) {
                    if (!recentQueueByToken.has(item.device_token)) {
                        recentQueueByToken.set(item.device_token, item);
                    }
                }

                for (const recipient of recipients) {
                    try {
                        const existingItem = recentQueueByToken.get(recipient.device_token);

                        if (existingItem) {
                            if (existingItem.status === NotificationStatuses.enum.DELIVERY_PENDING) {
                                logger.info(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 8)}... — already pending`);
                                continue;
                            }

                            // [Skip if notification sent within last 48h]
                            const time = existingItem.delivered_at || existingItem.created_at;
                            if (new Date(time).getTime() > Date.now() - 1000 * 60 * 60 * 48) {
                                logger.info(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 8)}... — recently sent`);
                                continue;
                            }
                        }

                        const dailyVerse = await this.fetchDailyVerse();
                        if (!dailyVerse) {
                            logger.warn(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 8)}... — no verse found`);
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
                            logger.error(`[${this.props.category}] Failed to enqueue ${recipient.device_token.slice(0, 8)}...`, insertError);
                        }

                        await new Promise(resolve => setTimeout(resolve, 400));
                    } catch (err) {
                        logger.error(`[${this.props.category}] Unexpected error processing recipient ${recipient.device_token.slice(0, 8)}...`, err);
                    }
                }
            } catch (error) {
                logger.error(`[${this.props.category}] Error in updateLiveQueue`, error);
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
            const randomChapter = Math.floor(Math.random() * 114) + 1;

            const { data, error } = await supabaseClient()
                .from("ws_quran_index")
                .select("verse_id, chapter:ws_quran_chapters(chapter_number, title_english), text:ws_quran_text(english)")
                .eq("chapter_number", randomChapter)
                .order("verse_number", { ascending: false });

            if (error) {
                logger.error(`[${this.props.category}] Error fetching daily verse`, error);
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
            logger.error(`[${this.props.category}] Critical error fetching daily verse`, error);
        }

        return null;
    }
}
