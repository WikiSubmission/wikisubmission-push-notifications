import { RouteOptions } from "fastify";
import { parseQueries } from "../../utils/parse-queries";
import { NotificationCategories, NotificationStatuses } from "../../notifications/notification-types";
import { IOSClient } from "../../utils/ios-client";
import { supabaseInternalClient } from "../../utils/supabase-client";
import { getEnv } from "../../utils/get-env";
import { PrayerTimesNotification } from "../../notifications/prayer-times";
import { RandomVerseNotification } from "../../notifications/random-verse";

export default function route(): RouteOptions {
    return {
        url: "/send-notification",
        method: "POST",
        handler: async (request, reply) => {
            const queries = parseQueries(request.query, request.params, request.body);

            const { api_key, device_token, platform, category } = queries;

            let authenticatedUserId: string | null = null;
            if (api_key !== getEnv("WIKISUBMISSION_API_KEY")) {
                const authHeader = request.headers.authorization;
                if (authHeader && authHeader.startsWith("Bearer ")) {
                    const token = authHeader.split(" ")[1];
                    const { data: { user }, error } = await supabaseInternalClient().auth.getUser(token);
                    if (user && !error) {
                        authenticatedUserId = user.id;
                    }
                }

                if (!authenticatedUserId) {
                    reply.status(401).send({ success: false, message: "Invalid API key or unauthorized" });
                    return;
                }
            }

            if (!device_token || !platform || !category) {
                reply.status(400).send({ success: false, message: "Missing one or more required parameter(s): 'device_token', 'platform', 'category'" });
                return;
            }

            if (authenticatedUserId) {
                const { data: userRecord } = await supabaseInternalClient()
                    .from("ws_push_notifications_users")
                    .select("user_id")
                    .eq("device_token", device_token)
                    .single();

                if (!userRecord || userRecord.user_id !== authenticatedUserId) {
                    reply.status(403).send({ success: false, message: "Unauthorized: Device token does not belong to user" });
                    return;
                }
            }

            if (!(category in NotificationCategories.enum)) {
                reply.status(400).send({ success: false, message: "Invalid category" });
                return;
            }

            const PrayerNotificationManager = new PrayerTimesNotification();
            const RandomVerseNotificationManager = new RandomVerseNotification();

            const { data: userData } = await supabaseInternalClient()
                .from("ws_push_notifications_registry_prayer_times")
                .select("*")
                .eq("device_token", device_token)
                .single();

            switch (category) {
                case NotificationCategories.enum.PRAYER_TIMES: {
                    if (!userData?.location) {
                        return reply.status(400).send({ success: false, message: "Missing location" });
                    }

                    const prayerTimes = await PrayerNotificationManager.fetchPrayerTimes(userData.location, userData.afternoon_midpoint_method === true);

                    if (!prayerTimes) {
                        return reply.status(400).send({ success: false, message: "Failed to fetch prayer times" });
                    }

                    const payload = PrayerNotificationManager.generateNotificationPayload(device_token, prayerTimes);

                    if (!payload) {
                        return reply.status(400).send({ success: false, message: "Failed to generate notification payload" });
                    }

                    try {
                        await new IOSClient().send({
                            ...payload
                        });

                        await supabaseInternalClient()
                            .from("ws_push_notifications_queue")
                            .insert({
                                scheduled_time: new Date().toISOString(),
                                delivered_at: new Date().toISOString(),
                                device_token,
                                category: NotificationCategories.enum.PRAYER_TIMES,
                                status: NotificationStatuses.enum.DELIVERY_SUCCEEDED,
                                payload,
                                api_triggered: true
                            });

                        return reply.status(200).send({ success: true });
                    } catch (error) {
                        console.error(error);
                        return reply.status(400).send({ success: false });
                    }
                }

                case NotificationCategories.enum.RANDOM_VERSE: {
                    const randomVerse = await RandomVerseNotificationManager.fetchRandomVerse();

                    if (!randomVerse) {
                        return reply.status(400).send({ success: false, message: "Failed to fetch random verse" });
                    }

                    const payload = RandomVerseNotificationManager.generateNotificationPayload(device_token, randomVerse.verseId, randomVerse.title, randomVerse.body);

                    if (!payload) {
                        return reply.status(400).send({ success: false, message: "Failed to generate notification payload" });
                    }

                    try {
                        await new IOSClient().send({
                            ...payload
                        });

                        await supabaseInternalClient()
                            .from("ws_push_notifications_queue")
                            .insert({
                                scheduled_time: new Date().toISOString(),
                                delivered_at: new Date().toISOString(),
                                device_token,
                                category: NotificationCategories.enum.RANDOM_VERSE,
                                status: NotificationStatuses.enum.DELIVERY_SUCCEEDED,
                                payload,
                                api_triggered: true
                            });

                        return reply.status(200).send({ success: true });
                    } catch (error) {
                        console.error(error);
                        return reply.status(400).send({ success: false });
                    }
                }

                default: {
                    return reply.status(400).send({ success: false, message: "Category not implemented yet" });
                }
            }
        }
    }
}