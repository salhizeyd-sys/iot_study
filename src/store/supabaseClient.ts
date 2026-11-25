import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

let clientInstance: SupabaseClient | null = null;

export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const env = (import.meta as any).env || {};
  const url = String(env.VITE_SUPABASE_URL || '').trim();
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

export function getSupabaseClient(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  if (!clientInstance) {
    clientInstance = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return clientInstance;
}

export async function signInWithMagicLink(
  email: string,
  redirectTo?: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('لم يتم ضبط إعدادات Supabase بعد');
  }
  const cleanEmail = email.trim();
  if (!cleanEmail) {
    throw new Error('أدخل البريد الإلكتروني أولاً');
  }
  const targetRedirect =
    redirectTo || (typeof window !== 'undefined' ? window.location.origin : undefined);
  const { error } = await client.auth.signInWithOtp({
    email: cleanEmail,
    options: targetRedirect ? { emailRedirectTo: targetRedirect } : undefined,
  });
  if (error) throw new Error(error.message);
}

export async function signOutSupabase(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function getCurrentSupabaseUser(): Promise<User | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}
