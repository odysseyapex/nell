import { NextResponse } from 'next/server';

import { runNightlyIntelligence } from '@/lib/jobs/nightly';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Nightly intelligence recompute.
 *
 * Guarded by a shared secret rather than a session: there is no user here.
 * Refusing to run when CRON_SECRET is unset is deliberate — an unauthenticated
 * endpoint that rewrites every organization's alerts is not something to leave
 * open by default.
 */
export async function POST(request: Request) {
  const { CRON_SECRET } = serverEnv();

  if (!CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured; scheduled jobs are disabled.' },
      { status: 503 },
    );
  }

  const authorization = request.headers.get('authorization');
  if (authorization !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const started = Date.now();
  const result = await runNightlyIntelligence();

  return NextResponse.json({ ...result, durationMs: Date.now() - started });
}

// Vercel Cron issues GET requests; the same guard applies.
export const GET = POST;
