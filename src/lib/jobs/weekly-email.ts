import 'server-only';

import { generateAlerts } from '@/lib/alerts/engine';
import { type AttentionLine, weeklyCoachEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';
import { computeClientMetrics } from '@/lib/metrics';
import { addDays, todayIn } from '@/lib/metrics/dates';
import { detectPatterns } from '@/lib/patterns/engine';
import { RISK_ORDER, assessRisk } from '@/lib/risk';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { CommitmentFact, ExerciseEntry, Organization, Profile, RiskLevel } from '@/lib/types';
import { displayName } from '@/lib/format';

/**
 * The weekly coach email.
 *
 * One job: answer "who needs me this week?" before the coach has opened
 * anything. It is sent per coach and lists only their own assigned clients,
 * because an email about someone else's roster is noise the coach will learn
 * to ignore.
 */

export interface WeeklyEmailResult {
  coachesEmailed: number;
  skipped: number;
  errors: string[];
}

export async function runWeeklyCoachEmails(): Promise<WeeklyEmailResult> {
  const admin = createSupabaseAdminClient();
  const result: WeeklyEmailResult = { coachesEmailed: 0, skipped: 0, errors: [] };

  const { data: organizations } = await admin
    .from('organizations')
    .select('*')
    .eq('status', 'active');

  for (const organization of (organizations ?? []) as Organization[]) {
    try {
      const referenceDate = todayIn(organization.timezone);
      const since = addDays(referenceDate, -120);

      const [{ data: staff }, { data: assignments }, { data: facts }, { data: entries }] =
        await Promise.all([
          admin
            .from('profiles')
            .select('*')
            .eq('organization_id', organization.id)
            .in('role', ['coach', 'organization_owner'])
            .eq('status', 'active'),
          admin
            .from('coach_client_assignments')
            .select('coach_id, client_id')
            .eq('organization_id', organization.id),
          admin
            .from('commitment_facts')
            .select('*')
            .eq('organization_id', organization.id)
            .gte('commitment_date', since),
          admin
            .from('exercise_entries')
            .select('*')
            .eq('organization_id', organization.id)
            .gte('entry_date', since),
        ]);

      const { data: clients } = await admin
        .from('profiles')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('role', 'client')
        .in('status', ['active', 'invited']);

      const clientById = new Map(((clients ?? []) as Profile[]).map((client) => [client.id, client]));

      const clientsByCoach = new Map<string, string[]>();
      for (const row of (assignments ?? []) as { coach_id: string; client_id: string }[]) {
        clientsByCoach.set(row.coach_id, [...(clientsByCoach.get(row.coach_id) ?? []), row.client_id]);
      }

      for (const coach of (staff ?? []) as Profile[]) {
        const assigned = clientsByCoach.get(coach.id) ?? [];
        if (assigned.length === 0) {
          result.skipped += 1;
          continue;
        }

        const flagged: { line: AttentionLine; risk: RiskLevel; score: number }[] = [];
        let stable = 0;

        for (const clientId of assigned) {
          const client = clientById.get(clientId);
          if (!client) continue;

          const clientFacts = ((facts ?? []) as CommitmentFact[]).filter(
            (fact) => fact.client_id === clientId,
          );
          const clientEntries = ((entries ?? []) as ExerciseEntry[]).filter(
            (entry) => entry.client_id === clientId,
          );

          const metrics = computeClientMetrics({
            facts: clientFacts,
            referenceDate,
            exerciseEntries: clientEntries,
            lastActivityAt: lastActivity(clientFacts, clientEntries),
          });

          const patterns = detectPatterns(clientFacts, { referenceDate });
          const risk = assessRisk({ metrics, activePatterns: patterns.length });

          if (risk.level === 'stable') {
            stable += 1;
            continue;
          }

          const headline = generateAlerts({ metrics, patterns })[0];
          flagged.push({
            risk: risk.level,
            score: risk.score,
            line: {
              clientName: displayName(client),
              headline: headline?.title ?? risk.reasons[0]?.label ?? 'Worth a look',
              detail: headline?.recommendedAction ?? '',
            },
          });
        }

        // Silence is a feature: an email that says nothing every week trains
        // coaches to stop opening the one that matters.
        if (flagged.length === 0) {
          result.skipped += 1;
          continue;
        }

        // Most urgent first, so the email reads in the order the coach should act.
        flagged.sort(
          (a, b) =>
            RISK_ORDER[a.risk] - RISK_ORDER[b.risk] ||
            b.score - a.score ||
            a.line.clientName.localeCompare(b.line.clientName),
        );

        const message = weeklyCoachEmail({
          organizationName: organization.name,
          coachFirstName: coach.first_name || 'there',
          lines: flagged.slice(0, 10).map((item) => item.line),
          stableCount: stable,
        });

        const sent = await sendEmail({ ...message, to: coach.email });
        if (sent.sent) result.coachesEmailed += 1;
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

function lastActivity(facts: CommitmentFact[], entries: ExerciseEntry[]): string | null {
  const stamps: string[] = [];
  for (const fact of facts) {
    stamps.push(fact.created_at);
    if (fact.checked_in_at) stamps.push(fact.checked_in_at);
  }
  for (const entry of entries) stamps.push(entry.completed_at ?? entry.started_at);
  if (stamps.length === 0) return null;
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest));
}
