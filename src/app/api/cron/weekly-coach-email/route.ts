import { NextResponse } from 'next/server';

import { runWeeklyCoachEmails } from '@/lib/jobs/weekly-email';
import { runWeeklyClientSummaries } from '@/lib/jobs/reminders';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The weekly send: each coach gets their attention summary, each client gets
 * their own week back. Both run here so there is one weekly moment rather than
 * two, and a client never receives a summary on a different day to their coach.
 */
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

  const coaches = await runWeeklyCoachEmails();
  const clients = await runWeeklyClientSummaries();

  return NextResponse.json({ coaches, clients });
}

export const GET = POST;
