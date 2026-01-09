import { RouteOptions } from "fastify";
import { parseQueries } from "../../utils/parse-queries";
import { NotificationCategories } from "../../notifications/notification-types";
import { PrayerTimesNotification } from "../../notifications/prayer-times";
import { IOSClient } from "../../utils/ios-client";
import { supabaseClient } from "../../utils/supabase-client";
import { getEnv } from "../../utils/get-env";

export default function route(): RouteOptions {
    return {
        url: "/send-notification",
        method: "POST",
        handler: async (request, reply) => {
            const queries = parseQueries(request.query, request.params, request.body);

            const { api_key, device_token, platform, category } = queries;

            if (!api_key || api_key !== getEnv("WIKISUBMISSION_API_KEY")) {
                reply.status(400).send({ success: false, message: "Invalid API key" });
                return;
            }

            if (!device_token || !platform || !category) {
                reply.status(400).send({ success: false, message: "Missing one or more required parameter(s): 'device_token', 'platform', 'category'" });
                return;
            }

            if (!(category in NotificationCategories.enum)) {
                reply.status(400).send({ success: false, message: "Invalid category" });
                return;
            }

            const notification = new PrayerTimesNotification();

            const { data: userData } = await supabaseClient()
                .from("ws_push_notifications_registry_prayer_times")
                .select("*")
                .eq("device_token", device_token)
                .single();

            if (!userData?.location) {
                reply.status(400).send({ success: false });
                return;
            }

            const prayerTimes = await notification.fetchPrayerTimes(userData.location, userData.afternoon_midpoint_method === true);

            if (!prayerTimes) {
                reply.status(400).send({ success: false });
                return;
            }

            const payload = notification.generateNotificationPayload(device_token, prayerTimes);

            if (!payload) {
                reply.status(400).send({ success: false });
                return;
            }

            try {
                await new IOSClient().send({
                    ...payload
                });
                reply.status(200).send({ success: true });
            } catch (error) {
                console.error(error);
                reply.status(400).send({ success: false });
            }
        }
    }
}