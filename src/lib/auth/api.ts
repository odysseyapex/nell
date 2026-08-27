import 'server-only';

import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/auth/session';
import type { SessionContext, UserRole } from '@/lib/types';

/**
 * Authorization for route handlers.
 *
 * Route handlers cannot redirect the way pages do, so guards here return a
 * discriminated result. Callers must handle `ok: false` — TypeScript will not
 * let them reach `result.session` without checking.
 */
export type AuthResult =
  | { ok: true; session: SessionContext }
  | { ok: false; response: NextResponse };

export function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function authorize(roles?: UserRole[]): Promise<AuthResult> {
  const session = await getSessionContext();

  if (!session) {
    return { ok: false, response: jsonError(401, 'Not signed in') };
  }
  if (roles && !roles.includes(session.profile.role)) {
    return { ok: false, response: jsonError(403, 'Not permitted') };
  }
  return { ok: true, session };
}

