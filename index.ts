import { PrayerTimesNotification } from "./notifications/prayer-times";
import { RandomVerseNotification } from "./notifications/random-verse";
import { Server } from "./server";
import dotenv from "dotenv";

(async () => {

    dotenv.config();

    await Server.instance.start();

    await new PrayerTimesNotification().start();
    await new RandomVerseNotification().start();
})();