import { isoWeekday } from '@/lib/metrics/dates';
import type { CheckinOutcome, CommitmentFact, CommitmentStatus } from '@/lib/types';

let counter = 0;

export function statusForOutcome(outcome: CheckinOutcome | null): CommitmentStatus {
  if (outcome === null) return 'planned';
  if (outcome === 'completed') return 'completed';
  if (outcome === 'missed') return 'missed';
  return 'changed';
}

export interface FactOverrides {
  date: string;
  outcome?: CheckinOutcome | null;
  status?: CommitmentStatus;
  confidence?: number | null;
  reason?: { slug: string; name?: string; category?: string } | null;
  createdHour?: number | null;
  clientId?: string;
}

export function fact(overrides: FactOverrides): CommitmentFact {
  counter += 1;
  const outcome = overrides.outcome === undefined ? 'completed' : overrides.outcome;
  const status = overrides.status ?? statusForOutcome(outcome);
  const weekday = isoWeekday(overrides.date);

  return {
    commitment_id: `c-${counter}`,
    organization_id: 'org-1',
    client_id: overrides.clientId ?? 'client-1',
    commitment_text: 'Walk for 30 minutes after work',
    commitment_category: null,
    commitment_date: overrides.date,
    due_at: `${overrides.date}T18:00:00.000Z`,
    confidence_score: overrides.confidence === undefined ? 80 : overrides.confidence,
    status,
    created_at: `${overrides.date}T08:00:00.000Z`,
    created_hour_local: overrides.createdHour === undefined ? 8 : overrides.createdHour,
    weekday,
    is_weekend: weekday >= 6,
    outcome,
    checked_in_at: outcome ? `${overrides.date}T21:00:00.000Z` : null,
    emotion: null,
    reason_code_id: overrides.reason ? `reason-${overrides.reason.slug}` : null,
    reason_slug: overrides.reason?.slug ?? null,
    reason_name: overrides.reason?.name ?? overrides.reason?.slug ?? null,
    reason_category: overrides.reason?.category ?? (overrides.reason ? 'situational' : null),
  };
}

/**
 * Builds a run of daily commitments starting at `start`, cycling through the
 * supplied outcomes. Handy for producing a believable stretch of history
 * without hand-writing thirty rows.
 */
export function series(
  start: string,
  count: number,
  outcomes: (CheckinOutcome | null)[],
  extra: Partial<FactOverrides> = {},
): CommitmentFact[] {
  const facts: CommitmentFact[] = [];
  for (let index = 0; index < count; index += 1) {
    const ms = Date.parse(`${start}T00:00:00.000Z`) + index * 86_400_000;
    const date = new Date(ms).toISOString().slice(0, 10);
    facts.push(fact({ ...extra, date, outcome: outcomes[index % outcomes.length] }));
  }
  return facts;
}
