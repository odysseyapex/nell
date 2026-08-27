import { cookies } from 'next/headers';
import { type CookieOptions, createServerClient } from '@supabase/ssr';

import { requireSupabaseConfig } from '@/lib/env';
import { createDemoClient, isDemoMode } from '@/lib/demo/supabase';

export const DEMO_COOKIE = 'nell_demo_user';

/**
 * Request-scoped Supabase client for React Server Components, server actions
 * and route handlers.
 *
 * Runs as the signed-in user, so every query it makes is subject to Row Level
 * Security. This is the client that should be used almost everywhere; reach
 * for the admin client only in the handful of places documented there.
 */
export async function createSupabaseServerClient() {
  // cookies() is awaited first so that touching this client marks the route as
  // dynamic. Reading configuration first would throw during `next build`'s
  // prerender pass instead of simply opting the page out of static rendering.
  const cookieStore = await cookies();

  // Development harness: with NELL_DEMO_MODE=1 the whole application runs
  // against an in-memory dataset instead of Postgres. Every page, action and
  // engine above this line is unchanged.
  if (isDemoMode()) {
    return createDemoClient({
      getAuthUserId: () => cookieStore.get(DEMO_COOKIE)?.value ?? null,
      clearSession: () => {
        try {
          cookieStore.delete(DEMO_COOKIE);
        } catch {
          // Read-only cookie store in a Server Component; the /demo route
          // handles switching.
        }
      },
    }) as unknown as ReturnType<typeof createServerClient>;
  }

  const { url, anonKey } = requireSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where the cookie store is
          // read-only. The middleware refreshes the session, so this is safe.
        }
      },
    },
  });
}
