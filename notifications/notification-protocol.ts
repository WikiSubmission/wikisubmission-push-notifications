import z from "zod";
import { NotificationCategories, NotificationPayload, NotificationStatuses } from "./notification-types";
import { supabaseInternalClient } from "../utils/supabase-client";
import { IOSClient } from "../utils/ios-client";
import { Database } from "../types/supabase-internal";
import { logger } from "../utils/logger";

type QueueRow = Database['internal']['Tables']['ws_push_notifications_queue']['Row'];
type CategoryRow = Database['internal']['Tables']['ws_push_notifications_categories']['Row'];
type StatusRow = Database['internal']['Tables']['ws_push_notifications_statuses']['Row'];

export type QueueItem = QueueRow & {
    category: CategoryRow;
    status: StatusRow;
};

export abstract class NotificationProtocol {

    props: {
        category: z.infer<typeof NotificationCategories>;
    }

    constructor(props: {
        category: z.infer<typeof NotificationCategories>;
    }) {
        this.props = props;
    }

    private processingQueueIds = new Set<string>();

    async processLiveQueue(intervalMinutes: number, options?: {
        timeSensitive?: {
            maximumMinutesBeforeMarkingAsMissed: number
        },
        orderOldestFirst?: boolean
    }) {
        const fn = async () => {
            try {
                const queue = await this.getQueuedItemsForCategory(options?.orderOldestFirst);

                for (const i of queue) {
                    // [Mark missed if applicable]
                    if (options?.timeSensitive?.maximumMinutesBeforeMarkingAsMissed && new Date(i.scheduled_time).getTime() < new Date().getTime() - 1000 * 60 * options.timeSensitive.maximumMinutesBeforeMarkingAsMissed) {
                        logger.warn(`[${this.props.category}] Marking ${i.id.slice(0, 8)}... as MISSED (queued ${new Date(i.scheduled_time).toISOString()})`);
                        await supabaseInternalClient()
                            .from("ws_push_notifications_queue")
                            .update({
                                updated_at: new Date().toISOString(),
                                status: NotificationStatuses.enum.DELIVERY_MISSED,
                            })
                            .eq("id", i.id);

                        // [Move on to next queue item]
                        continue;
                    }

                    // [If `scheduled_time` in less than 2 minutes, set interval now]
                    // (Or if it was slightly late (< 5 mins), treat it as "due now")
                    if (new Date(i.scheduled_time).getTime() < new Date().getTime() + 1000 * 60 * 2) {
                        if (this.processingQueueIds.has(i.id)) continue;

                        this.processingQueueIds.add(i.id);

                        // Send notification at the `scheduled_time`
                        setTimeout(async () => {
                            // [Send notification]
                            try {
                                await this.sendNotification(
                                    i.id,
                                    JSON.parse(JSON.stringify(i.payload)) as z.infer<typeof NotificationPayload>
                                );
                            } catch (error) {
                                logger.error(`[NotificationProtocol] Error sending notification for queue item ${i.id}`, error);

                                // [Mark as failed]
                                try {
                                    await supabaseInternalClient()
                                        .from("ws_push_notifications_queue")
                                        .update({
                                            updated_at: new Date().toISOString(),
                                            status: NotificationStatuses.enum.DELIVERY_FAILED,
                                        })
                                        .eq("id", i.id);
                                } catch (err) {
                                    logger.error(`[NotificationProtocol] Critical error marking notification as failed:`, err);
                                }
                            } finally {
                                this.processingQueueIds.delete(i.id);
                            }
                        },
                            Math.max(0, new Date(i.scheduled_time).getTime() - new Date().getTime())
                        );
                    }
                }
            } catch (error) {
                logger.error(`[${this.props.category}] Error in processLiveQueue`, error);
            }
        }

        const run = async () => {
            await fn();
            setTimeout(run, 1000 * 60 * intervalMinutes);
        }

        await run();
    }

    /**
     * Inserts a pending queue item, tolerating concurrent enqueue passes.
     *
     * The per-category dedup (skip if already pending / recently sent) is a non-atomic
     * read-then-insert, so two overlapping runs (e.g. two server instances briefly alive
     * during a reload) can both decide to enqueue the same recipient. A partial unique
     * index on the queue (device_token, category) WHERE status = 'DELIVERY_PENDING' AND
     * api_triggered = false turns the losing insert into a unique violation (23505), which
     * we treat as a benign duplicate rather than an error or a second delivery.
     */
    protected async enqueue(item: {
        device_token: string;
        payload: z.infer<typeof NotificationPayload>;
        scheduled_time?: string;
    }): Promise<'inserted' | 'duplicate' | 'error'> {
        const { error } = await supabaseInternalClient()
            .from("ws_push_notifications_queue")
            .insert({
                scheduled_time: item.scheduled_time ?? new Date().toISOString(),
                device_token: item.device_token,
                status: NotificationStatuses.enum.DELIVERY_PENDING,
                category: this.props.category,
                payload: item.payload as any
            });

        if (error) {
            // 23505 = unique_violation: another concurrent pass already enqueued this recipient.
            if ((error as { code?: string }).code === '23505') {
                return 'duplicate';
            }
            logger.error(`[${this.props.category}] Failed to enqueue ${item.device_token.slice(0, 8)}...`, error);
            return 'error';
        }

        return 'inserted';
    }

    async sendNotification(queueId: string, payload: z.infer<typeof NotificationPayload>) {
        if (!payload) {
            await supabaseInternalClient()
                .from("ws_push_notifications_queue")
                .update({
                    updated_at: new Date().toISOString(),
                    status: NotificationStatuses.enum.DELIVERY_FAILED,
                })
                .eq("id", queueId);

            return;
        }

        try {
            await new IOSClient().send(payload);

            // [Mark as delivered]
            await supabaseInternalClient()
                .from("ws_push_notifications_queue")
                .update({
                    updated_at: new Date().toISOString(),
                    delivered_at: new Date().toISOString(),
                    status: NotificationStatuses.enum.DELIVERY_SUCCEEDED,
                    payload
                })
                .eq("id", queueId);
        } catch (error) {
            logger.error(`[NotificationProtocol] Error sending notification for queue item ${queueId}`, error);

            // [Mark as failed]
            await supabaseInternalClient()
                .from("ws_push_notifications_queue")
                .update({
                    updated_at: new Date().toISOString(),
                    status: NotificationStatuses.enum.DELIVERY_FAILED,
                })
                .eq("id", queueId);
        }
    }

    async getQueuedItemsForCategory(orderOldestFirst?: boolean): Promise<QueueRow[]> {
        try {
            const { data, error } = await supabaseInternalClient()
                .from("ws_push_notifications_queue")
                .select("*")
                .eq("category", this.props.category)
                .eq("status", NotificationStatuses.enum.DELIVERY_PENDING)
                .order("created_at", { ascending: orderOldestFirst ?? false })
                .limit(50);

            if (error) {
                logger.error(`[${this.props.category}] Error getting queue`, error);
                return [];
            }

            return data || [];
        } catch (error) {
            logger.error(`[${this.props.category}] Critical error getting queue items`, error);
            return [];
        }
    }

    async getQueuedItemsInCategoryForUser(deviceToken: string): Promise<QueueItem[]> {
        try {
            const { data, error } = await supabaseInternalClient()
                .from("ws_push_notifications_queue")
                .select("*, category: ws_push_notifications_categories(*), status: ws_push_notifications_statuses(*)")
                .eq("device_token", deviceToken)
                .order("created_at", { ascending: false });

            if (error) {
                logger.error(`[${this.props.category}] Error getting user queue`, error);
                return [];
            }

            return (data as unknown as QueueItem[])?.filter(
                i => i.category.name === this.props.category
            ) || [];
        } catch (error) {
            logger.error(`[${this.props.category}] Critical error getting user queue items`, error);
            return [];
        }
    }
}