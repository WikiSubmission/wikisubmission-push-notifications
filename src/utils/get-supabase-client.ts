import { createClient } from '@supabase/supabase-js';
import { getEnv } from './get-env';
import { Database } from '../types/database.types';

export function getSupabaseInternalClient() {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database, "internal">(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      db: { 
        schema: 'internal',
      }
    }
  );
}
