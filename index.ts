import { PrayerTimesNotification } from "./notifications/prayer-times";
import { DailyVerseNotification } from "./notifications/daily-verse";
import { DailyRemindersNotification } from "./notifications/daily-reminders";
import { AnnouncementsNotification } from "./notifications/announcements";
import { Server } from "./server";
import dotenv from "dotenv";

(async () => {

    dotenv.config();

    await Server.instance.start();

    await new PrayerTimesNotification().start();
    await new DailyVerseNotification().start();
    await new DailyRemindersNotification().start();
    await new AnnouncementsNotification().start();
})();
