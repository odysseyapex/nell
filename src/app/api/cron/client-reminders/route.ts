import { NextResponse } from 'next/server';

import { runCheckinReminders } from '@/lib/jobs/reminders';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily nudge for clients with an outstanding check-in. */
export async function POST(request: Request) {
  const { CRON_SECRET } = serverEnv();

  if (!CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured; scheduled jobs are disabled.' },
      { status: 503 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  return NextResponse.json(await runCheckinReminders());
}

export const GET = POST;
