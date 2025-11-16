import z from "zod";

export const NotificationPlatforms = z.enum([
    "ios"
]);

export const NotificationTypes = z.enum([
    "random_verse",
    "daily_verse",
    "daily_chapter",
    "prayer_times",
]);

export const Notification = z.object({
    token: z.string(),
    content: z.object({
        title: z.string(),
        body: z.string(),
        category: NotificationTypes,
        expirationHours: z.number(),
        deepLink: z.string(),
        metadata: z.object({
            chapter_number: z.number().optional(),
            verse_id: z.string().optional(),
        }).optional(),
    }),
    options: z.object({
        critical: z.boolean().optional(),
    }).optional(),
});