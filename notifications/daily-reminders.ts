import z from "zod";
import { supabaseInternalClient } from "../utils/supabase-client";
import { NotificationProtocol } from "./notification-protocol";
import { NotificationCategories, NotificationPayload, NotificationStatuses } from "./notification-types";

type DailyReminder = {
    id: string;
    title: string;
    body: string;
    deepLink: string;
};

const DAILY_REMINDERS: DailyReminder[] = [
    { id: "remember-god-alone", title: "Daily Reminder", body: "Remember God alone.", deepLink: "wikisubmission://home" },
    { id: "quran-alone-guidance", title: "Daily Reminder", body: "The Quran is complete, clear, and fully detailed guidance.", deepLink: "wikisubmission://quran" },
    { id: "guard-contact-prayers", title: "Daily Reminder", body: "Guard the contact prayers and protect your connection with God.", deepLink: "wikisubmission://prayer-times" },
    { id: "life-is-a-test", title: "Daily Reminder", body: "This worldly life is a test. Keep your sight on the Hereafter.", deepLink: "wikisubmission://home" },
    { id: "devote-religion", title: "Daily Reminder", body: "Devote your religion absolutely to God alone.", deepLink: "wikisubmission://quran" },
    { id: "seek-gods-approval", title: "Daily Reminder", body: "Seek God's approval, not people's approval.", deepLink: "wikisubmission://home" },
    { id: "steady-remembrance", title: "Daily Reminder", body: "A steady remembrance of God softens the heart.", deepLink: "wikisubmission://home" },
    { id: "charity-purifies", title: "Daily Reminder", body: "Charity purifies wealth and soul.", deepLink: "wikisubmission://home" },
    { id: "repent-quickly", title: "Daily Reminder", body: "Repent quickly and sincerely when you slip.", deepLink: "wikisubmission://home" },
    { id: "truth-over-tradition", title: "Daily Reminder", body: "Truth is not measured by tradition or numbers.", deepLink: "wikisubmission://quran" },
    { id: "hold-quran-firmly", title: "Daily Reminder", body: "Hold fast to the Quran and do not seek another source of religious law.", deepLink: "wikisubmission://quran" },
    { id: "god-sees-intentions", title: "Daily Reminder", body: "God sees what is in the heart before actions reach the limbs.", deepLink: "wikisubmission://home" },
    { id: "prayer-before-pressure", title: "Daily Reminder", body: "When pressure builds, turn to prayer before anything else.", deepLink: "wikisubmission://prayer-times" },
    { id: "simple-submission", title: "Daily Reminder", body: "Submission is simple: worship God alone and follow His revelation.", deepLink: "wikisubmission://quran" },
    { id: "gratitude-opens-doors", title: "Daily Reminder", body: "Gratitude opens doors that complaint never will.", deepLink: "wikisubmission://home" },
    { id: "verify-before-sharing", title: "Daily Reminder", body: "Verify before you repeat. Truth deserves care.", deepLink: "wikisubmission://home" },
    { id: "god-is-near", title: "Daily Reminder", body: "God is near. Call upon Him sincerely.", deepLink: "wikisubmission://home" },
    { id: "do-not-follow-majority", title: "Daily Reminder", body: "Do not assume the majority is right. Stand with truth.", deepLink: "wikisubmission://quran" },
    { id: "fear-god-not-people", title: "Daily Reminder", body: "Fear God, not people.", deepLink: "wikisubmission://home" },
    { id: "guard-your-tongue", title: "Daily Reminder", body: "Guard your tongue. Words can elevate or ruin a day.", deepLink: "wikisubmission://home" },
    { id: "purify-intention", title: "Daily Reminder", body: "Purify your intention before your action.", deepLink: "wikisubmission://home" },
    { id: "zikr-throughout-day", title: "Daily Reminder", body: "Keep God in mind throughout the day, not only at set moments.", deepLink: "wikisubmission://home" },
    { id: "be-honest", title: "Daily Reminder", body: "Be honest, even when honesty costs you.", deepLink: "wikisubmission://home" },
    { id: "trust-gods-plan", title: "Daily Reminder", body: "Trust God's plan even when you cannot yet read it.", deepLink: "wikisubmission://home" },
    { id: "quran-heals", title: "Daily Reminder", body: "The Quran heals hearts that approach it with sincerity.", deepLink: "wikisubmission://quran" },
    { id: "avoid-idolizing-humans", title: "Daily Reminder", body: "Never idolize a person, teacher, or group. All devotion belongs to God.", deepLink: "wikisubmission://quran" },
    { id: "daily-reading", title: "Daily Reminder", body: "Read even a little Quran today, then pause and reflect.", deepLink: "wikisubmission://quran" },
    { id: "steadiness-over-bursts", title: "Daily Reminder", body: "Steady devotion is better than short bursts followed by neglect.", deepLink: "wikisubmission://home" },
    { id: "satan-discourages", title: "Daily Reminder", body: "Discouragement is one of Satan's favorite tools. Push back with remembrance.", deepLink: "wikisubmission://home" },
    { id: "check-ego", title: "Daily Reminder", body: "Check the ego before it turns a small issue into rebellion.", deepLink: "wikisubmission://home" },
    { id: "do-not-despair", title: "Daily Reminder", body: "Do not despair of God's mercy.", deepLink: "wikisubmission://home" },
    { id: "stay-gentle", title: "Daily Reminder", body: "Stay gentle with believers and firm with falsehood.", deepLink: "wikisubmission://home" },
    { id: "purity-of-worship", title: "Daily Reminder", body: "Purity of worship matters more than public appearance.", deepLink: "wikisubmission://home" },
    { id: "remember-the-covenant", title: "Daily Reminder", body: "Remember why you are here: to uphold your covenant with God.", deepLink: "wikisubmission://home" },
    { id: "do-good-quietly", title: "Daily Reminder", body: "Do good quietly. God sees it.", deepLink: "wikisubmission://home" },
    { id: "measure-by-quran", title: "Daily Reminder", body: "Measure every religious claim against the Quran.", deepLink: "wikisubmission://quran" },
    { id: "worldly-lure", title: "Daily Reminder", body: "Do not let this temporary world distract you from eternal stakes.", deepLink: "wikisubmission://home" },
    { id: "feed-the-soul", title: "Daily Reminder", body: "Feed the soul before feeding the ego.", deepLink: "wikisubmission://home" },
    { id: "contact-prayer-anchor", title: "Daily Reminder", body: "The contact prayer is your anchor. Do not let it drift.", deepLink: "wikisubmission://prayer-times" },
    { id: "simple-remembrance", title: "Daily Reminder", body: "Remember God often.", deepLink: "wikisubmission://home" },
    { id: "simple-quran", title: "Daily Reminder", body: "Read the Quran today.", deepLink: "wikisubmission://quran" },
    { id: "simple-gratitude", title: "Daily Reminder", body: "Be grateful today.", deepLink: "wikisubmission://home" },
    { id: "simple-repent", title: "Daily Reminder", body: "Repent and move forward.", deepLink: "wikisubmission://home" },
    { id: "simple-prayer", title: "Daily Reminder", body: "Do not miss the prayer.", deepLink: "wikisubmission://prayer-times" },
    { id: "simple-charity", title: "Daily Reminder", body: "Give what you can.", deepLink: "wikisubmission://home" },
    { id: "simple-humility", title: "Daily Reminder", body: "Stay humble before God.", deepLink: "wikisubmission://home" },
    { id: "simple-truth", title: "Daily Reminder", body: "Choose truth over comfort.", deepLink: "wikisubmission://home" },
    { id: "simple-patience", title: "Daily Reminder", body: "Practice patience.", deepLink: "wikisubmission://home" },
    { id: "simple-sincerity", title: "Daily Reminder", body: "Be sincere with God.", deepLink: "wikisubmission://home" },
    { id: "numerical-sign", title: "Daily Reminder", body: "The Quran carries a mathematical signature for those who reflect.", deepLink: "wikisubmission://quran" },
    { id: "proof-and-faith", title: "Daily Reminder", body: "Proof strengthens faith when the heart is honest.", deepLink: "wikisubmission://quran" },
    { id: "do-not-compromise", title: "Daily Reminder", body: "Do not compromise the truth to fit in.", deepLink: "wikisubmission://home" },
    { id: "shun-sectarianism", title: "Daily Reminder", body: "Sectarianism divides. Submission unites under God alone.", deepLink: "wikisubmission://quran" },
    { id: "examine-yourself", title: "Daily Reminder", body: "Examine yourself before criticizing others.", deepLink: "wikisubmission://home" },
    { id: "keep-company-wise", title: "Daily Reminder", body: "Keep company that reminds you of God.", deepLink: "wikisubmission://home" },
    { id: "money-is-trust", title: "Daily Reminder", body: "Money is a trust, not a master.", deepLink: "wikisubmission://home" },
    { id: "children-are-test", title: "Daily Reminder", body: "Family is a blessing, but also a test. Keep God first.", deepLink: "wikisubmission://home" },
    { id: "be-fair", title: "Daily Reminder", body: "Be fair, even when emotions run high.", deepLink: "wikisubmission://home" },
    { id: "no-intermediaries", title: "Daily Reminder", body: "There are no intermediaries between you and God.", deepLink: "wikisubmission://home" },
    { id: "direct-supplication", title: "Daily Reminder", body: "Ask God directly. He is fully sufficient.", deepLink: "wikisubmission://home" },
    { id: "clean-income", title: "Daily Reminder", body: "Seek clean income and avoid gains that poison the heart.", deepLink: "wikisubmission://home" },
    { id: "god-knows-hidden", title: "Daily Reminder", body: "God knows the hidden motives behind visible actions.", deepLink: "wikisubmission://home" },
    { id: "be-steadfast", title: "Daily Reminder", body: "Be steadfast when truth feels lonely.", deepLink: "wikisubmission://home" },
    { id: "question-inherited-religion", title: "Daily Reminder", body: "Inherited religion is not a substitute for personal conviction.", deepLink: "wikisubmission://quran" },
    { id: "reflect-after-reading", title: "Daily Reminder", body: "Do not just read. Reflect.", deepLink: "wikisubmission://quran" },
    { id: "listen-and-reason", title: "Daily Reminder", body: "Listen carefully, then use reason honestly.", deepLink: "wikisubmission://quran" },
    { id: "hypocrisy-warning", title: "Daily Reminder", body: "Hypocrisy begins when image matters more than truth.", deepLink: "wikisubmission://home" },
    { id: "be-useful", title: "Daily Reminder", body: "Be useful to people without seeking worship from them.", deepLink: "wikisubmission://home" },
    { id: "god-controls-outcome", title: "Daily Reminder", body: "You control effort. God controls outcome.", deepLink: "wikisubmission://home" },
    { id: "remember-death", title: "Daily Reminder", body: "Remember death. It sharpens priorities.", deepLink: "wikisubmission://home" },
    { id: "small-acts-count", title: "Daily Reminder", body: "Small righteous acts count when done consistently for God.", deepLink: "wikisubmission://home" },
    { id: "lighten-burden-with-faith", title: "Daily Reminder", body: "Faith lightens burdens that anxiety makes heavier.", deepLink: "wikisubmission://home" },
    { id: "keep-heart-clean", title: "Daily Reminder", body: "Keep resentment out of the heart as much as you can.", deepLink: "wikisubmission://home" },
    { id: "quran-supersedes-opinion", title: "Daily Reminder", body: "The Quran supersedes personal opinion in matters of religion.", deepLink: "wikisubmission://quran" },
    { id: "resist-showing-off", title: "Daily Reminder", body: "Resist showing off. Quiet sincerity is safer.", deepLink: "wikisubmission://home" },
    { id: "be-thankful-when-tested", title: "Daily Reminder", body: "Even trials can carry mercy. Stay thankful and alert.", deepLink: "wikisubmission://home" },
    { id: "focus-on-reform", title: "Daily Reminder", body: "Personal reform is always more urgent than public posture.", deepLink: "wikisubmission://home" },
    { id: "god-provides", title: "Daily Reminder", body: "God is the provider. Do not panic over provision.", deepLink: "wikisubmission://home" },
    { id: "avoid-rumors", title: "Daily Reminder", body: "Avoid rumors and protect your time from gossip.", deepLink: "wikisubmission://home" },
    { id: "be-kind-at-home", title: "Daily Reminder", body: "Be kind at home too. Religion starts there.", deepLink: "wikisubmission://home" },
    { id: "slow-down-and-think", title: "Daily Reminder", body: "Slow down enough to think before reacting.", deepLink: "wikisubmission://home" },
    { id: "submission-is-freedom", title: "Daily Reminder", body: "Submission to God is freedom from every false master.", deepLink: "wikisubmission://home" },
    { id: "seek-knowledge-humbly", title: "Daily Reminder", body: "Seek knowledge humbly, and let it make you softer, not harsher.", deepLink: "wikisubmission://quran" },
    { id: "be-accountable", title: "Daily Reminder", body: "You will answer to God alone. Live like it.", deepLink: "wikisubmission://home" },
    { id: "today-matters", title: "Daily Reminder", body: "Today matters. Do not waste it heedlessly.", deepLink: "wikisubmission://home" },
    { id: "recenter-now", title: "Daily Reminder", body: "Recenter now.", deepLink: "wikisubmission://home" },
    { id: "pray-on-time", title: "Daily Reminder", body: "Pray on time.", deepLink: "wikisubmission://prayer-times" },
    { id: "god-alone", title: "Daily Reminder", body: "God alone.", deepLink: "wikisubmission://home" },
    { id: "read-and-reflect", title: "Daily Reminder", body: "Read and reflect.", deepLink: "wikisubmission://quran" },
    { id: "stay-sincere", title: "Daily Reminder", body: "Stay sincere.", deepLink: "wikisubmission://home" },
    { id: "choose-the-hereafter", title: "Daily Reminder", body: "Choose the Hereafter over appearance.", deepLink: "wikisubmission://home" },
    { id: "patience-and-prayer", title: "Daily Reminder", body: "Seek help through patience and prayer.", deepLink: "wikisubmission://prayer-times" }
];

const REPEAT_WINDOW_DAYS = 14;
const MINIMUM_SUPPORTED_VERSION = "3.17";

export class DailyRemindersNotification extends NotificationProtocol {

    constructor() {
        super({
            category: NotificationCategories.enum.DAILY_REMINDERS
        });
    }

    async start() {
        await this.updateLiveQueue(240);
        await this.processLiveQueue(300, {
            timeSensitive: {
                maximumMinutesBeforeMarkingAsMissed: 8 * 60
            },
            orderOldestFirst: true
        });
    }

    async updateLiveQueue(intervalMinutes: number) {
        const fn = async () => {
            try {
                const { data: recipients, error: recipientsError } = await supabaseInternalClient()
                    .schema("internal")
                    .from("ws_push_notifications_users")
                    .select("device_token, version, daily_reminders_registry: ws_push_notifications_registry_daily_reminders(enabled)")
                    .eq("enabled", true)
                    .eq("daily_reminders_registry.enabled", true)
                    .order("created_at", { ascending: false });

                if (recipientsError) {
                    console.error(`[${this.props.category}] Error fetching recipients:`, recipientsError);
                    return;
                }

                if (!recipients) return;

                const eligibleRecipients = recipients.filter((recipient) =>
                    isVersionAtLeast(recipient.version, MINIMUM_SUPPORTED_VERSION)
                );

                console.log(`[${this.props.category}] === Daily Reminders Queue ===`);

                // [Batch-fetch recent queue items for all eligible recipients]
                const allTokens = eligibleRecipients.map(r => r.device_token);
                const since24h = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
                const { data: batchExisting, error: batchError } = await supabaseInternalClient()
                    .from("ws_push_notifications_queue")
                    .select("device_token, status, delivered_at, created_at")
                    .in("device_token", allTokens)
                    .eq("category", NotificationCategories.enum.DAILY_REMINDERS)
                    .eq("api_triggered", false)
                    .in("status", [NotificationStatuses.enum.DELIVERY_PENDING, NotificationStatuses.enum.DELIVERY_SUCCEEDED])
                    .gte("created_at", since24h)
                    .order("created_at", { ascending: false });

                if (batchError) {
                    console.error(`[${this.props.category}] Error batch-fetching queue items:`, batchError);
                }

                const recentQueueByToken = new Map<string, NonNullable<typeof batchExisting>[0]>();
                for (const item of batchExisting ?? []) {
                    if (!recentQueueByToken.has(item.device_token)) {
                        recentQueueByToken.set(item.device_token, item);
                    }
                }

                for (const recipient of eligibleRecipients) {
                    try {
                        const existingItem = recentQueueByToken.get(recipient.device_token);

                        if (existingItem) {
                            if (existingItem.status === NotificationStatuses.enum.DELIVERY_PENDING) {
                                console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - already pending`);
                                continue;
                            }

                            const time = existingItem.delivered_at || existingItem.created_at;
                            if (new Date(time).getTime() > Date.now() - 1000 * 60 * 60 * 24) {
                                console.log(`[${this.props.category}] Skipping ${recipient.device_token.slice(0, 5)}... - notification recently sent`);
                                continue;
                            }
                        }

                        const recentReminderIds = await this.getRecentReminderIds(recipient.device_token);
                        const reminder = this.getReminder(recipient.device_token, recentReminderIds);
                        const payload = this.generateNotificationPayload(
                            recipient.device_token,
                            reminder
                        );

                        const { error: insertError } = await supabaseInternalClient()
                            .from("ws_push_notifications_queue")
                            .insert({
                                scheduled_time: new Date().toISOString(),
                                device_token: recipient.device_token,
                                status: NotificationStatuses.enum.DELIVERY_PENDING,
                                category: NotificationCategories.enum.DAILY_REMINDERS,
                                payload: payload as any
                            });

                        if (insertError) {
                            console.error(`[${this.props.category}] Error adding to queue for ${recipient.device_token}:`, insertError);
                        }

                        await new Promise(resolve => setTimeout(resolve, 400));
                    } catch (err) {
                        console.error(`[${this.props.category}] Unexpected error processing recipient ${recipient.device_token}:`, err);
                    }
                }
            } catch (error) {
                console.error(`[${this.props.category}] Error in updateLiveQueue:`, error);
            }
        };

        const run = async () => {
            await fn();
            setTimeout(run, 1000 * 60 * intervalMinutes);
        };

        await run();
    }

    generateNotificationPayload(deviceToken: string, reminder: DailyReminder): z.infer<typeof NotificationPayload> {
        return {
            deviceToken,
            title: reminder.title,
            body: reminder.body,
            category: this.props.category,
            deepLink: reminder.deepLink,
            expirationHours: 8,
            metadata: {
                reminder_id: reminder.id
            }
        };
    }

    async getRecentReminderIds(deviceToken: string): Promise<Set<string>> {
        const since = new Date(Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabaseInternalClient()
            .from("ws_push_notifications_queue")
            .select("payload")
            .eq("device_token", deviceToken)
            .eq("category", NotificationCategories.enum.DAILY_REMINDERS)
            .eq("status", NotificationStatuses.enum.DELIVERY_SUCCEEDED)
            .gte("delivered_at", since)
            .order("delivered_at", { ascending: false })
            .limit(50);

        if (error) {
            console.error(`[${this.props.category}] Error fetching recent reminder history for ${deviceToken}:`, error);
            return new Set();
        }

        return new Set(
            (data ?? [])
                .map((item) => (item.payload as { metadata?: { reminder_id?: string } } | null)?.metadata?.reminder_id)
                .filter((value): value is string => !!value)
        );
    }

    getReminder(deviceToken: string, recentReminderIds: Set<string> = new Set()) {
        const eligible = DAILY_REMINDERS.filter(reminder => !recentReminderIds.has(reminder.id));
        const pool = eligible.length > 0 ? eligible : DAILY_REMINDERS;

        const dayBucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
        const seed = `${deviceToken}:${dayBucket}:${pool.length}`
            .split("")
            .reduce((total, char, index) => total + char.charCodeAt(0) * (index + 1), 0);

        return pool[seed % pool.length];
    }
}

function isVersionAtLeast(version: string | null | undefined, minimum: string): boolean {
    if (!version) return false;

    const current = version.split(".").map((part) => parseInt(part, 10) || 0);
    const target = minimum.split(".").map((part) => parseInt(part, 10) || 0);
    const length = Math.max(current.length, target.length);

    for (let index = 0; index < length; index += 1) {
        const left = current[index] ?? 0;
        const right = target[index] ?? 0;

        if (left > right) return true;
        if (left < right) return false;
    }

    return true;
}
