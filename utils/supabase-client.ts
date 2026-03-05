import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database as InternalDatabase } from "../types/supabase-internal";
import { Database } from "../types/supabase";
import { getEnv } from "./get-env";

let internalClient: SupabaseClient<InternalDatabase> | null = null;
let publicClient: SupabaseClient<Database> | null = null;

export const supabaseInternalClient = () => {
    if (internalClient) return internalClient;

    const url = getEnv("SUPABASE_URL");
    const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    
    internalClient = createClient<InternalDatabase>(url, key, {
        db: {
            schema: "internal"
        }
    });

    return internalClient;
}

export const supabaseClient = () => {
    if (publicClient) return publicClient;

    const url = getEnv("SUPABASE_URL");
    const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    publicClient = createClient<Database>(url, key);

    return publicClient;
}