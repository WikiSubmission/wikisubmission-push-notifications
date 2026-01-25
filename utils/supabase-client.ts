import { createClient } from "@supabase/supabase-js";
import { Database as InternalDatabase } from "../types/supabase-internal";
import { Database } from "../types/supabase";
import { getEnv } from "./get-env";

export const supabaseInternalClient = () => {
    const url = getEnv("SUPABASE_URL");
    const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    return createClient<InternalDatabase>(url, key, {
        db: {
            schema: "internal"
        }
    });
}

export const supabaseClient = () => {
    const url = getEnv("SUPABASE_URL");
    const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    return createClient<Database>(url, key);
}