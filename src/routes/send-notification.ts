import { RouteOptions } from "fastify";
import { Notification, NotificationPlatforms, NotificationTypes } from "../types/notification";
import { NotificationContentIOS } from "../utils/notification-content-ios";
import { NotificationManagerIOS } from "../utils/notification-manager-ios";
import { getQueries } from "../utils/get-queries";
import { getSupabaseInternalClient } from "../utils/get-supabase-client";
import z from "zod";

export default function route(): RouteOptions {
    return {
        url: "/send-notification",
        method: "POST",
        handler: async (request, reply) => {
            try {
                const inputs = getQueries(request.query, request.params, request.body);

                if (inputs["api_key"] !== process.env.API_KEY) {
                    return reply.code(401).send({
                        error: "Unauthorized",
                        description: "Invalid API key",
                    });
                }

                if (
                    !inputs ||
                    !inputs["device_token"] ||
                    !NotificationPlatforms.safeParse(inputs["platform"]).success ||
                    !NotificationTypes.safeParse(inputs["type"]).success
                ) {
                    return reply.code(400).send({
                        error: "Bad Request",
                        description: "Valid device token, platform and type are required",
                    });
                }

                // Additional validation for custom notifications
                if (inputs["type"] === "custom") {
                    if (!inputs["title"]) {
                        return reply.code(400).send({
                            error: "Bad Request",
                            description: "Custom notifications require 'title' and 'message' parameters",
                        });
                    }
                }

                let content: z.infer<typeof Notification>["content"] | null = null;

                let onSuccess: () => Promise<void> = async () => { };

                switch (inputs["type"]) {
                    case "random_verse":
                        content = await NotificationContentIOS.shared.randomVerse();
                        onSuccess = async () => {
                            await getSupabaseInternalClient()
                                .from('ws_notifications_ios')
                                .update({
                                    last_delivery_at: new Date().toISOString(),
                                })
                                .eq('device_token', inputs["device_token"]);
                        }
                        break;
                    case "daily_verse":
                        content = await NotificationContentIOS.shared.verseOfTheDay(inputs["device_token"], inputs["force"] === "true");
                        onSuccess = async () => {
                            await getSupabaseInternalClient()
                                .from('ws_notifications_ios')
                                .update({
                                    last_delivery_at: new Date().toISOString(),
                                    daily_verse_last_delivery_at: new Date().toISOString(),
                                })
                                .eq('device_token', inputs["device_token"]);
                        }
                        break;
                    case "daily_chapter":
                        content = await NotificationContentIOS.shared.chapterOfTheDay(inputs["device_token"], inputs["force"] === "true");
                        onSuccess = async () => {
                            await getSupabaseInternalClient()
                                .from('ws_notifications_ios')
                                .update({
                                    last_delivery_at: new Date().toISOString(),
                                    daily_chapter_last_delivery_at: new Date().toISOString(),
                                })
                                .eq('device_token', inputs["device_token"]);
                        }
                        break;
                    case "prayer_times":
                        content = await NotificationContentIOS.shared.prayerTimes(inputs["device_token"], inputs["force"] === "true");
                        onSuccess = async () => {
                            await getSupabaseInternalClient()
                                .from('ws_notifications_ios')
                                .update({
                                    last_delivery_at: new Date().toISOString(),
                                    prayer_times_last_delivery_at: new Date().toISOString(),
                                })
                                .eq('device_token', inputs["device_token"]);
                        }
                        break;
                    case "custom":
                        content = {
                            title: inputs["title"],
                            body: inputs["message"],
                            category: 'custom',
                            deepLink: inputs["deep_link"] || "wikisubmission://home",
                            expirationHours: inputs["expiration_hours"] ? parseInt(inputs["expiration_hours"]) : 24,
                            metadata: {}
                        };
                        onSuccess = async () => {
                            await getSupabaseInternalClient()
                                .from('ws_notifications_ios')
                                .update({
                                    last_delivery_at: new Date().toISOString(),
                                })
                                .eq('device_token', inputs["device_token"]);
                        }
                        break;
                    default:
                        return reply.code(400).send({
                            error: "Bad Request",
                            description: "Invalid notification type",
                        });
                }

                if (!content) {
                    return reply.code(200).send({
                        message: "Notification conditions not met",
                        description: "Please try again later, or, use the 'force' parameter if applicable",
                    });
                }

                await NotificationManagerIOS.shared.send({
                    token: inputs["device_token"],
                    content,
                    options: { 
                        critical: inputs["type"] === "prayer_times" ? true : false,
                    }
                });

                await onSuccess();

                return reply.code(200).send({
                    message: "Notification sent successfully",
                    content
                });
            } catch (error) {
                request.log.error(error);
                return reply.code(500).send({
                    error: "Internal Server Error",
                    description: "An error occurred while sending the notification",
                });
            }
        }
    }

}