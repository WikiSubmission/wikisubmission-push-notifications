import { createClient } from "@supabase/supabase-js";
import { Database } from "../types/supabase";
import { getEnv } from "./get-env";

export const supabaseClient = () => {
    const url = getEnv("SUPABASE_URL");
    const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    return createClient<Database>(url, key, {
        db: {
            schema: "internal"
        }
    });
}