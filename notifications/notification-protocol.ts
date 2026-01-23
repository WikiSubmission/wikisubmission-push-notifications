import z from "zod";
import { NotificationCategories, NotificationPayload, NotificationStatuses } from "./notification-types";
import { supabaseClient } from "../utils/supabase-client";
import { IOSClient } from "../utils/ios-client";
import { Database } from "../types/supabase";

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

    abstract invalidateNotificationDeliveryForQueuedItem(queueItem: QueueItem): Promise<boolean>;

    async processLiveQueue(intervalMinutes: number) {
        const fn = async () => {
            const queue = await this.getQueuedItemsForCategory();

            for (const i of queue) {
                // 1. [Handle pending notifications]
                if (i.status.name === NotificationStatuses.enum.DELIVERY_PENDING) {
                    console.log(`[NotificationProtocol] Processing queue: ${i.device_token.slice(0, 5)}... (status: ${i.status.name})`);

                    // [Check if should cancel]
                    // (e.g. user disabled notifications)
                    if (await this.invalidateNotificationDeliveryForQueuedItem(i)) {
                        await supabaseClient()
                            .from("ws_push_notifications_queue")
                            .update({
                                updated_at: new Date().toISOString(),
                                status: NotificationStatuses.enum.DELIVERY_CANCELLED,
                            })
                            .eq("id", i.id);
                        continue;
                    }

                    // [Mark missed if 5+ minutes late]
                    if (new Date(i.scheduled_time).getTime() < new Date().getTime() - 1000 * 60 * 5) {
                        await supabaseClient()
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
                        console.log(`[NotificationProtocol] Processing queue item ${i.id} - DUE NOW`);

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
                                console.error(`[NotificationProtocol] Error sending notification for queue item ${i.id}`, error);

                                // [Mark as failed]
                                await supabaseClient()
                                    .from("ws_push_notifications_queue")
                                    .update({
                                        updated_at: new Date().toISOString(),
                                        status: NotificationStatuses.enum.DELIVERY_FAILED,
                                    })
                                    .eq("id", i.id);
                            }

                            this.processingQueueIds.delete(i.id);
                        },
                            Math.max(0, new Date(i.scheduled_time).getTime() - new Date().getTime())
                        );
                    }
                }
            }
        }

        await fn();

        setInterval(async () => {
            await fn();
        }, 1000 * 60 * intervalMinutes);
    }

    async sendNotification(queueId: string, payload: z.infer<typeof NotificationPayload>) {
        if (!payload) {
            await supabaseClient()
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
            await supabaseClient()
                .from("ws_push_notifications_queue")
                .update({
                    updated_at: new Date().toISOString(),
                    delivered_at: new Date().toISOString(),
                    status: NotificationStatuses.enum.DELIVERY_SUCCEEDED,
                    payload
                })
                .eq("id", queueId);
        } catch (error) {
            console.error(`[NotificationProtocol] Error sending notification for queue item ${queueId}`, error);

            // [Mark as failed]
            await supabaseClient()
                .from("ws_push_notifications_queue")
                .update({
                    updated_at: new Date().toISOString(),
                    status: NotificationStatuses.enum.DELIVERY_FAILED,
                })
                .eq("id", queueId);
        }
    }

    async getQueuedItemsForCategory(): Promise<QueueItem[]> {
        const { data, error } = await supabaseClient()
            .from("ws_push_notifications_queue")
            .select("*, category: ws_push_notifications_categories(*), status: ws_push_notifications_statuses(*)")
            .order("created_at", { ascending: false });

        if (error) {
            console.error(`[${this.props.category}] Error getting queue`, error);
            return [];
        }

        return (data as unknown as QueueItem[])?.filter(
            i => i.category.name === this.props.category
        ) || [];
    }

    async getQueuedItemsInCategoryForUser(deviceToken: string): Promise<QueueItem[]> {
        const { data, error } = await supabaseClient()
            .from("ws_push_notifications_queue")
            .select("*, category: ws_push_notifications_categories(*), status: ws_push_notifications_statuses(*)")
            .eq("device_token", deviceToken)
            .order("created_at", { ascending: false });

        if (error) {
            console.error(`[${this.props.category}] Error getting user queue`, error);
            return [];
        }

        return (data as unknown as QueueItem[])?.filter(
            i => i.category.name === this.props.category
        ) || [];
    }
}