import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { ConfigurationError, requireSupabaseConfig, serverEnv } from '@/lib/env';
import { createDemoAdminClient, isDemoMode } from '@/lib/demo/supabase';

/**
 * Service-role client. Bypasses Row Level Security.
 *
 * Legitimate uses are narrow, and all of them are moments where there is no
 * signed-in user yet, or where the work belongs to the platform rather than to
 * a person:
 *
 *   - creating the first profile during signup
 *   - reading and accepting an invitation token
 *   - Stripe webhooks
 *   - the nightly intelligence job
 *   - seeding demo data
 *
 * It must never be used to serve a request on behalf of a signed-in user —
 * that is what createSupabaseServerClient() is for. Every call site here
 * carries the responsibility of scoping its own queries to one organization.
 */
export function createSupabaseAdminClient() {
  // Development harness: the same in-memory dataset, unscoped.
  if (isDemoMode()) {
    return createDemoAdminClient() as unknown as ReturnType<typeof createClient>;
  }

  const { url } = requireSupabaseConfig();
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new ConfigurationError(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required for signup, invitations, webhooks and seeding.',
    );
  }

  return createClient(url, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
