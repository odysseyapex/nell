import 'server-only';

import { checkinReminderEmail, weeklyClientEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';
import { followThroughOf, inWindow, lastNDays, tallyReasons } from '@/lib/metrics';
import { addDays, todayIn } from '@/lib/metrics/dates';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Commitment, CommitmentFact, Organization, Profile } from '@/lib/types';

/**
 * Client-facing email.
 *
 * Nell is stingy with these on purpose. A client who feels chased stops
 * recording honestly, and dishonest check-ins are worse than missing ones —
 * they put wrong numbers in front of the coach. So:
 *
 *   - one nudge per client per day, at most, and only when something is
 *     genuinely outstanding
 *   - nothing at all for a client with no overdue check-in
 *   - the weekly summary reports what happened without a score or a verdict
 */

export interface ReminderResult {
  remindersSent: number;
  summariesSent: number;
  skipped: number;
  errors: string[];
}

/** Nudges clients who have a commitment whose day has passed with no check-in. */
export async function runCheckinReminders(): Promise<ReminderResult> {
  const admin = createSupabaseAdminClient();
  const result: ReminderResult = { remindersSent: 0, summariesSent: 0, skipped: 0, errors: [] };

  const { data: organizations } = await admin
    .from('organizations')
    .select('*')
    .eq('status', 'active');

  for (const organization of (organizations ?? []) as Organization[]) {
    try {
      const today = todayIn(organization.timezone);

      const { data: overdue } = await admin
        .from('commitments')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('status', 'planned')
        .lt('commitment_date', today)
        // Anything older than a week is a conversation for the coach, not a
        // nudge from software.
        .gte('commitment_date', addDays(today, -7))
        .order('commitment_date', { ascending: false });

      const commitments = (overdue ?? []) as Commitment[];
      if (commitments.length === 0) continue;

      // One email per client, about their most recent outstanding commitment.
      const byClient = new Map<string, Commitment>();
      for (const commitment of commitments) {
        if (!byClient.has(commitment.client_id)) byClient.set(commitment.client_id, commitment);
      }

      const { data: clients } = await admin
        .from('profiles')
        .select('*')
        .in('id', [...byClient.keys()])
        .eq('status', 'active');

      for (const client of (clients ?? []) as Profile[]) {
        const commitment = byClient.get(client.id);
        if (!commitment) continue;

        const message = checkinReminderEmail({
          organizationName: organization.name,
          clientFirstName: client.first_name || 'there',
          commitmentText: commitment.commitment_text,
          commitmentDate: commitment.commitment_date,
        });

        const sent = await sendEmail({ ...message, to: client.email });
        if (sent.sent) result.remindersSent += 1;
        else result.skipped += 1;
      }
    } catch (error) {
      result.errors.push(
        `${organization.slug}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  return result;
}

/** The weekly client summary: what happened, with no score attached. */
export async function runWeeklyClientSummaries(): Promise<ReminderResult> {
  const admin = createSupabaseAdminClient();
  const result: ReminderResult = { remindersSent: 0, summariesSent: 0, skipped: 0, errors: [] };

  const { data: organizations } = await admin
    .from('organizations')
    .select('*')
    .eq('status', 'active');

  for (const organization of (organizations ?? []) as Organization[]) {
    try {
      const today = todayIn(organization.timezone);
      const window = lastNDays(today, 7);

      const [{ data: clients }, { data: facts }] = await Promise.all([
        admin
          .from('profiles')
          .select('*')
          .eq('organization_id', organization.id)
          .eq('role', 'client')
          .eq('status', 'active'),
        admin
          .from('commitment_facts')
          .select('*')
          .eq('organization_id', organization.id)
          .gte('commitment_date', window.start),
      ]);

      for (const client of (clients ?? []) as Profile[]) {
        const clientFacts = ((facts ?? []) as CommitmentFact[]).filter(
          (fact) => fact.client_id === client.id,
        );
        const week = inWindow(clientFacts, window);
        const followThrough = followThroughOf(week);

        // Nothing recorded means nothing to report. Sending "you did 0 of 0"
        // to someone who had a hard week is worse than saying nothing.
        if (followThrough.eligible === 0) {
          result.skipped += 1;
          continue;
        }

        const message = weeklyClientEmail({
          organizationName: organization.name,
          clientFirstName: client.first_name || 'there',
          followThrough7: followThrough.rate,
          completed: followThrough.completed,
          eligible: followThrough.eligible,
          topReason: tallyReasons(week)[0]?.name ?? null,
        });

        const sent = await sendEmail({ ...message, to: client.email });
        if (sent.sent) result.summariesSent += 1;
        else result.skipped += 1;
      }
    } catch (error) {
      result.errors.push(
        `${organization.slug}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  return result;
}
