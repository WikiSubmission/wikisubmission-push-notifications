import z from "zod";
import { supabaseClient, supabaseInternalClient } from "../utils/supabase-client";
import { NotificationProtocol } from "./notification-protocol";
import { NotificationCategories, NotificationPayload, NotificationStatuses } from "./notification-types";

export class RandomVerseNotification extends NotificationProtocol {

    constructor() {
        super({
            category: NotificationCategories.enum.RANDOM_VERSE
        });
    }

    async start() {
        // [Internally update queue for this category]
        await this.updateLiveQueue(120);
        // [Process queue for this category]
        await this.processLiveQueue(120);
    }

    async updateLiveQueue(intervalMinutes: number) {
        const fn = async () => {
            const { data: recipients } = await supabaseInternalClient()
                .schema("internal")
                .from("ws_push_notifications_users")
                .select("*, random_verse_registry: ws_push_notifications_registry_random_verse(*)")
                .eq("enabled", true)
                .eq("random_verse_registry.enabled", true)
                .order("created_at", { ascending: false });

            if (!recipients) return;

            console.log(`[${this.props.category}] === Random Verse Queue ===`)

            for (const recipient of recipients) {
                // [Skip if notification recently sent or currently pending]
                const { data: existingItem } = await supabaseInternalClient()
                    .from("ws_push_notifications_queue")
                    .select("*")
                    .eq("device_token", recipient.device_token)
                    .eq("category", NotificationCategories.enum.RANDOM_VERSE)
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

                    // [Skip if notification sent within last 48h]
                    const time = existingItem.delivered_at || existingItem.created_at;
                    if (new Date(time).getTime() > Date.now() - 1000 * 60 * 60 * 48) {
                        console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - notification recently sent`);
                        continue;
                    }
                }

                const randomVerse = await this.fetchRandomVerse();
                if (!randomVerse) {
                    console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - no random verse found`);
                    continue;
                }

                const payload = this.generateNotificationPayload(recipient.device_token, randomVerse.verseId, randomVerse.title, randomVerse.body);

                // [Enqueue the notification with the payload]
                // [The queue is separately processed and should trigger within a minute]
                const { error } = await supabaseInternalClient()
                    .from("ws_push_notifications_queue")
                    .insert({
                        scheduled_time: new Date().toISOString(),
                        device_token: recipient.device_token,
                        status: NotificationStatuses.enum.DELIVERY_PENDING,
                        category: NotificationCategories.enum.RANDOM_VERSE,
                        payload: payload as any
                    });

                if (error) {
                    console.error(`[${this.props.category}] Error adding to queue for ${recipient.device_token}:`, error);
                }

                await new Promise(resolve => setTimeout(resolve, 400));
            }
        }

        setInterval(async () => {
            await fn();
        }, 1000 * 60 * intervalMinutes);
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

    async fetchRandomVerse(): Promise<{ verseId: string, title: string, body: string } | null> {
        const randomChapter = Math.floor(Math.random() * 114);

        const { data } = await supabaseClient()
            .from("ws_quran_index")
            .select("*, chapter:ws_quran_chapters(*), text:ws_quran_text(*)")
            .eq("chapter_number", randomChapter)
            .order("verse_number", { ascending: false });

        if (data) {
            const randomVerse = Math.floor(Math.random() * data.length);
            const verse = data[randomVerse];

            return {
                verseId: verse.verse_id,
                title: `Sura ${verse.chapter.chapter_number}, ${verse.chapter.title_english}`,
                body: `[${verse.verse_id}] ${verse.text?.english}`
            }
        }

        return null;
    }
}