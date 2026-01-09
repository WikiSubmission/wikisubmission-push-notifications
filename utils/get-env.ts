import { Server } from "../server";

export type EnvironmentVariables =
    | "SUPABASE_URL"
    | "SUPABASE_SERVICE_ROLE_KEY"
    | "APNS_ENV"
    | "APNS_BUNDLE_ID"
    | "APNS_TEAM_ID"
    | "APNS_KEY_ID"
    | "APNS_PRIVATE_KEY"
    | "WIKISUBMISSION_API_KEY";

export function getEnv(
    secret: EnvironmentVariables,
): string {
    let value = process.env[secret];
    if (!value) {
        Server.instance.error(
            `Environment variable not found: ${secret}. Crashing.`,
        );
        process.exit(1);
    }
    return value;
}