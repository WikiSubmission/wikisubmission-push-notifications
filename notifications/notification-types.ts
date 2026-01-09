import z from "zod";

export const NotificationCategories = z.enum([
    'ANNOUNCEMENTS',
    'PRAYER_TIMES',
    'DAILY_CHAPTER',
    'DAILY_VERSE'
]);
export const NotificationStatuses = z.enum([
    'DELIVERY_PENDING',
    'DELIVERY_SUCCEEDED',
    'DELIVERY_MISSED',
    'DELIVERY_FAILED',
    'DELIVERY_CANCELLED'
]);
export const NotificationPayload = z.object({
    deviceToken: z.string(),
    title: z.string(),
    body: z.string(),
    category: NotificationCategories,
    expirationHours: z.number().default(24),
    deepLink: z.string().startsWith("wikisubmission://").optional(),
    metadata: z.object({
        chapter_number: z.number().optional(),
        verse_id: z.string().optional(),
    }).optional(),
    critical: z.boolean().optional(),
});