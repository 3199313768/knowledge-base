import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

export function createSupabaseBrowserClient() {
  const supabaseUrl =
    import.meta.env.VITE_SUPABASE_URL ??
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    import.meta.env.VITE_SUPABASE_ANON_KEY ??
    import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase 客户端配置缺失');
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

export function getSupabaseBrowserClient() {
  supabase ??= createSupabaseBrowserClient();
  return supabase;
}
