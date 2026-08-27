'use client';

import { createBrowserClient } from '@supabase/ssr';

import { requireSupabaseConfig } from '@/lib/env';

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser Supabase client. Anon key only — RLS does the rest. */
export function createSupabaseBrowserClient() {
  if (!client) {
    const { url, anonKey } = requireSupabaseConfig();
    client = createBrowserClient(url, anonKey);
  }
  return client;
}
