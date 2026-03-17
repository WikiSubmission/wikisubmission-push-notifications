import { NotificationProtocol } from "./notification-protocol";
import { NotificationCategories, NotificationStatuses } from "./notification-types";
import { supabaseInternalClient } from "../utils/supabase-client";

// To send a new announcement: add an entry with a stable unique `id` (generate once, never change).
// To stop sending: remove the entry (already-delivered users won't be re-notified).
const ACTIVE_ANNOUNCEMENTS: Array<{
    id: string;
    title: string;
    body: string;
    deepLink?: string;
    sandboxOnly?: boolean;
    expiresAt: string; // ISO string — stop attempting delivery after this time
}> = [
        // {
        //     id: "550e8400-e29b-41d4-a716-446655440009",
        //     title: "🙌 New tracks",
        //     body: "🎵 Help Me God, Rise & Praise, and more - tap to listen!",
        //     deepLink: "wikisubmission://music/track/510b00c5-7377-4b6d-a3fc-4ab55f589e09",
        //     sandboxOnly: true,
        //     expiresAt: "2026-03-17T23:59:59Z",
        // }
    ];

export class AnnouncementsNotification extends NotificationProtocol {

    constructor() {
        super({ category: NotificationCategories.enum.ANNOUNCEMENTS });
    }

    async start() {
        await this.updateLiveQueue(5);
        await this.processLiveQueue(1, {
            timeSensitive: {
                maximumMinutesBeforeMarkingAsMissed: 24 * 60
            }
        });
    }

    private async updateLiveQueue(intervalMinutes: number) {
        const fn = async () => {
            if (ACTIVE_ANNOUNCEMENTS.length === 0) return;

            try {
                const { data: recipients, error: recipientsError } = await supabaseInternalClient()
                    .from("ws_push_notifications_users")
                    .select("device_token, is_sandbox, announcements_registry: ws_push_notifications_registry_announcements(enabled)")
                    .eq("enabled", true)
                    .eq("announcements_registry.enabled", true);

                if (recipientsError) {
                    console.error(`[${this.props.category}] Error fetching recipients:`, recipientsError);
                    return;
                }

                if (!recipients || recipients.length === 0) return;

                const deviceTokens = recipients.map(r => r.device_token); // all enabled recipients, used per-announcement below

                for (const announcement of ACTIVE_ANNOUNCEMENTS) {
                    if (new Date(announcement.expiresAt) < new Date()) {
                        console.log(`[${this.props.category}] Skipping "${announcement.title}" — expired`);
                        continue;
                    }

                    console.log(`[${this.props.category}] === ${announcement.title} ===`);

                    // Batch-fetch who has already received this specific announcement
                    const { data: existing, error: existingError } = await supabaseInternalClient()
                        .from("ws_push_notifications_queue")
                        .select("device_token")
                        .in("device_token", deviceTokens)
                        .eq("category", NotificationCategories.enum.ANNOUNCEMENTS)
                        .in("status", [NotificationStatuses.enum.DELIVERY_PENDING, NotificationStatuses.enum.DELIVERY_SUCCEEDED, NotificationStatuses.enum.DELIVERY_FAILED])
                        .filter("payload->>announcement_id", "eq", announcement.id);

                    if (existingError) {
                        console.error(`[${this.props.category}] Error checking existing queue items:`, existingError);
                        continue;
                    }

                    const alreadyQueued = new Set((existing ?? []).map(r => r.device_token));
                    const targets = announcement.sandboxOnly ? recipients.filter(r => r.is_sandbox) : recipients;

                    for (const recipient of targets) {
                        if (alreadyQueued.has(recipient.device_token)) {
                            console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - already queued`);
                            continue;
                        }

                        const { error: insertError } = await supabaseInternalClient()
                            .from("ws_push_notifications_queue")
                            .insert({
                                scheduled_time: new Date().toISOString(),
                                device_token: recipient.device_token,
                                status: NotificationStatuses.enum.DELIVERY_PENDING,
                                category: NotificationCategories.enum.ANNOUNCEMENTS,
                                payload: {
                                    deviceToken: recipient.device_token,
                                    title: announcement.title,
                                    body: announcement.body,
                                    category: NotificationCategories.enum.ANNOUNCEMENTS,
                                    ...(announcement.deepLink ? { deepLink: announcement.deepLink } : {}),
                                    expirationHours: 24,
                                    announcement_id: announcement.id,
                                } as any
                            });

                        if (insertError) {
                            console.error(`[${this.props.category}] Error adding to queue for ${recipient.device_token.slice(0, 5)}...:`, insertError);
                        } else {
                            console.log(`[${this.props.category}] Queued for ${recipient.device_token.slice(0, 5)}...`);
                        }

                        await new Promise(resolve => setTimeout(resolve, 150));
                    }
                }
            } catch (error) {
                console.error(`[${this.props.category}] Error in updateLiveQueue:`, error);
            }
        };

        const run = async () => {
            await fn();
            setTimeout(run, 1000 * 60 * intervalMinutes);
        };

        await run();
    }
}
