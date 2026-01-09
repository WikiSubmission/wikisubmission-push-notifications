import { PrayerTimesNotification } from "./notifications/prayer-times";
import { Server } from "./server";
import dotenv from "dotenv";

(async () => {

    dotenv.config();

    await Server.instance.start();

    const x = await new PrayerTimesNotification().start();
})();