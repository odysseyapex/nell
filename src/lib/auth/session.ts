import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { ConfigurationError } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Organization, Profile, SessionContext, UserRole } from '@/lib/types';

/**
 * Server-side authorization.
 *
 * Two rules hold everywhere in the app:
 *
 *   1. The caller's organization and role are resolved from the session, never
 *      accepted from the request. A client can ask for a resource by id; it can
 *      never assert which tenant it belongs to.
 *   2. Guards return the resolved context, so a route that has checked a role
 *      already has the profile it needs and cannot forget to use it.
 */

export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;

  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    // If Supabase is not configured we cannot verify a session, so there is
    // no session. Failing closed here means an unconfigured deployment
    // behaves like a signed-out one — guards redirect and API routes answer
    // 401 — rather than surfacing a 500 from every protected route.
    if (error instanceof ConfigurationError) {
      console.error('[auth] cannot resolve a session:', error.message);
      return null;
    }
    throw error;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle<Profile>();

  if (!profile) return null;

  let organization: Organization | null = null;
  if (profile.organization_id) {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', profile.organization_id)
      .maybeSingle<Organization>();
    organization = data;
  }

  return { authUserId: user.id, profile, organization };
});

export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect('/login');
  return session;
}

const STAFF_ROLES: UserRole[] = ['organization_owner', 'coach'];

/** Where a given role belongs when they land on the app root. */
export function homePathFor(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return '/admin';
    case 'client':
      return '/app/client';
    default:
      return '/app/coach';
  }
}

export async function requireRole(roles: UserRole[]): Promise<SessionContext> {
  const session = await requireSession();
  if (!roles.includes(session.profile.role)) {
    redirect(homePathFor(session.profile.role));
  }
  return session;
}

/** Coach or organization owner, with a guaranteed non-null organization. */
export async function requireStaff(): Promise<SessionContext & { organization: Organization }> {
  const session = await requireRole(STAFF_ROLES);
  if (!session.organization) redirect('/onboarding');
  return session as SessionContext & { organization: Organization };
}

export async function requireOwner(): Promise<SessionContext & { organization: Organization }> {
  const session = await requireRole(['organization_owner']);
  if (!session.organization) redirect('/onboarding');
  return session as SessionContext & { organization: Organization };
}

export async function requireClient(): Promise<SessionContext & { organization: Organization }> {
  const session = await requireRole(['client']);
  if (!session.organization) redirect('/login');
  return session as SessionContext & { organization: Organization };
}

export async function requireSuperAdmin(): Promise<SessionContext> {
  return requireRole(['super_admin']);
}

