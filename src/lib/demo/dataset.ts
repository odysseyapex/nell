/**
 * In-memory demo dataset.
 *
 * A development harness, not production code. It exists so the product can be
 * demonstrated end to end before a Supabase project is provisioned, and it is
 * only ever reachable when NELL_DEMO_MODE=1.
 *
 * It builds the same Claire Coaching workspace as scripts/seed.ts, from the
 * same fixed seed, and then runs the *real* pattern, alert and risk engines
 * over it. Nothing about the intelligence is faked: what you see on screen is
 * produced by src/lib/patterns and src/lib/alerts reading these rows, exactly
 * as it would read rows from Postgres.
 */

import { createHash } from 'node:crypto';

import { generateAlerts } from '@/lib/alerts/engine';
import { computeClientMetrics } from '@/lib/metrics';
import { addDays, isoWeekday, todayIn } from '@/lib/metrics/dates';
import { detectPatterns } from '@/lib/patterns/engine';
import { assessRisk } from '@/lib/risk';
import { composeBriefDeterministic } from '@/lib/ai/brief';
import type { CheckinOutcome, CommitmentFact } from '@/lib/types';

/**
 * Stable UUIDs for the demo rows.
 *
 * The application validates every id it receives from the browser as a UUID —
 * correctly, since those ids reach the database. Readable fixture ids like
 * "client-amanda" would therefore be rejected by the server actions, so the
 * demo mints real v4-shaped UUIDs that are deterministic per key: the same
 * fixture always gets the same id, and links stay stable across restarts.
 */
function id(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex');
  const variant = ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

const DAYS = 90;
const ORG_ID = id('org-claire');
const FRAMEWORK_ID = id('fw-pause-notice-choose');
const EXERCISE_ID = id('ex-daily-reflection');

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

// --- deterministic randomness ---------------------------------------------

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

// --- behaviour profiles, mirroring scripts/seed.ts -------------------------

interface DayPlan {
  outcome: CheckinOutcome;
  reasonSlug: string | null;
  confidence: number;
  createdHour: number;
  text: string;
}

const WALKING = [
  'Walk for 30 minutes after work',
  'Take the long way home on foot',
  'Twenty minutes outside before dinner',
];
const EATING = [
  'Eat a planned dinner rather than deciding at 7pm',
  'Sit down for lunch away from my desk',
  'Prepare tomorrow’s lunch tonight',
];
const EVENING = [
  'Phone out of the bedroom by 10pm',
  'Read for fifteen minutes before bed',
  'Lights out by 11pm',
];

interface ClientSpec {
  /** Readable handle used for the demo session cookie. */
  key: string;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  seed: number;
  commitments: string[];
  plan: (daysAgo: number, date: string, random: () => number, texts: string[]) => DayPlan;
}

const CLIENTS: ClientSpec[] = [
  {
    key: 'client-sarah',
    id: id('client-sarah'),
    firstName: 'Sarah',
    lastName: 'Miller',
    email: 'sarah@clairecoaching.demo',
    seed: 1001,
    commitments: [...WALKING, ...EATING],
    plan: (daysAgo, _date, random, texts) => {
      const recent = daysAgo <= 30;
      const veryRecent = daysAgo <= 14;
      const success = random() < (recent ? (veryRecent ? 0.45 : 0.6) : 0.84);

      if (success) {
        return {
          outcome: 'completed',
          reasonSlug: null,
          confidence: 75 + Math.floor(random() * 15),
          createdHour: 8 + Math.floor(random() * 3),
          text: pick(random, texts),
        };
      }
      const reason = veryRecent
        ? random() < 0.72
          ? 'stress'
          : pick(random, ['time', 'low-energy', 'schedule-change'])
        : pick(random, ['time', 'forgot', 'social-situation', 'stress', 'low-energy']);

      return {
        outcome: random() < 0.55 ? 'missed' : 'changed_impulsively',
        reasonSlug: reason,
        confidence: 70 + Math.floor(random() * 20),
        createdHour: 8 + Math.floor(random() * 4),
        text: pick(random, texts),
      };
    },
  },
  {
    key: 'client-jessica',
    id: id('client-jessica'),
    firstName: 'Jessica',
    lastName: 'Lane',
    email: 'jessica@clairecoaching.demo',
    seed: 2002,
    commitments: [...EATING, ...EVENING],
    plan: (_daysAgo, date, random, texts) => {
      const weekend = isoWeekday(date) >= 6;
      const success = random() < (weekend ? 0.28 : 0.88);

      if (success) {
        return {
          outcome: 'completed',
          reasonSlug: null,
          confidence: 78 + Math.floor(random() * 12),
          createdHour: 7 + Math.floor(random() * 3),
          text: pick(random, texts),
        };
      }
      return {
        outcome: random() < 0.5 ? 'missed' : 'changed_intentionally',
        reasonSlug: pick(random, ['social-situation', 'schedule-change', 'didnt-prepare', 'changed-my-mind']),
        confidence: 70 + Math.floor(random() * 15),
        createdHour: 9 + Math.floor(random() * 6),
        text: pick(random, texts),
      };
    },
  },
  {
    key: 'client-amanda',
    id: id('client-amanda'),
    firstName: 'Amanda',
    lastName: 'Brooks',
    email: 'amanda@clairecoaching.demo',
    seed: 3003,
    commitments: [...WALKING, ...EVENING],
    plan: (_daysAgo, _date, random, texts) => {
      if (random() < 0.93) {
        return {
          outcome: 'completed',
          reasonSlug: null,
          confidence: 80 + Math.floor(random() * 10),
          createdHour: 7 + Math.floor(random() * 2),
          text: pick(random, texts),
        };
      }
      return {
        outcome: 'circumstances_changed',
        reasonSlug: pick(random, ['schedule-change', 'time']),
        confidence: 85,
        createdHour: 8,
        text: pick(random, texts),
      };
    },
  },
  {
    key: 'client-rachel',
    id: id('client-rachel'),
    firstName: 'Rachel',
    lastName: 'Cole',
    email: 'rachel@clairecoaching.demo',
    seed: 4004,
    commitments: [...EATING, ...WALKING],
    plan: (_daysAgo, _date, random, texts) => {
      const confidence = 88 + Math.floor(random() * 10);
      if (random() < 0.58) {
        return {
          outcome: 'completed',
          reasonSlug: null,
          confidence,
          createdHour: 20 + Math.floor(random() * 3),
          text: pick(random, texts),
        };
      }
      return {
        outcome: random() < 0.4 ? 'missed' : 'changed_impulsively',
        reasonSlug: pick(random, ['hunger', 'changed-my-mind', 'didnt-prepare', 'low-energy']),
        confidence,
        createdHour: 21 + Math.floor(random() * 2),
        text: pick(random, texts),
      };
    },
  },
];

const REASONS: { slug: string; name: string; category: string }[] = [
  { slug: 'stress', name: 'Stress', category: 'emotional' },
  { slug: 'low-energy', name: 'Low energy', category: 'physical' },
  { slug: 'time', name: 'Not enough time', category: 'situational' },
  { slug: 'hunger', name: 'Hunger', category: 'physical' },
  { slug: 'social-situation', name: 'Social situation', category: 'situational' },
  { slug: 'schedule-change', name: 'Schedule changed', category: 'situational' },
  { slug: 'forgot', name: 'Forgot', category: 'cognitive' },
  { slug: 'didnt-prepare', name: 'Did not prepare', category: 'cognitive' },
  { slug: 'changed-my-mind', name: 'Changed my mind', category: 'motivational' },
  { slug: 'other', name: 'Other', category: 'other' },
];

const FRAMEWORK_STEPS = [
  { title: 'Pause — what happened?', description: 'Describe the moment plainly, before the explanation arrives.', input_type: 'long_text', required: true },
  { title: 'Notice — what were you thinking?', description: 'The thought as it turned up, not the tidied version.', input_type: 'long_text', required: false },
  { title: 'How did you feel?', description: '', input_type: 'short_text', required: false },
  { title: 'Choose — what did you do?', description: '', input_type: 'long_text', required: true },
  { title: 'Review — how settled do you feel about it?', description: '', input_type: 'scale', required: false, configuration_json: { min: 1, max: 10, minLabel: 'Unsettled', maxLabel: 'Settled' } },
];

const OBSTACLES = [
  'A late meeting',
  'Being tired after work',
  'Eating out with friends',
  'An early start the next day',
];

const REFLECTIONS = [
  ['Long day, got home late and the plan felt impossible.', 'This always happens on Thursdays.', 'Flat', 'Ordered in instead.'],
  ['Went for the walk even though I did not want to.', 'Just get out of the door.', 'Surprised', 'Walked the full loop.'],
  ['Skipped it after a difficult call at work.', 'I will do it tomorrow.', 'Frustrated', 'Stayed on the sofa.'],
  ['Prepped everything the night before.', 'It is already done, so I may as well.', 'Calm', 'Followed the plan.'],
  ['Meant to go, then a friend called.', 'I can move it.', 'Torn', 'Moved it and did not do it.'],
];

// --- build -----------------------------------------------------------------

function statusFor(outcome: CheckinOutcome) {
  if (outcome === 'completed') return 'completed';
  if (outcome === 'missed') return 'missed';
  return 'changed';
}

function build(): Tables {
  const today = todayIn('America/New_York');
  const now = new Date().toISOString();

  const tables: Tables = {
    organizations: [
      {
        id: ORG_ID,
        name: 'Claire Coaching',
        slug: 'claire-coaching',
        logo_url: null,
        primary_color: '#0F766E',
        secondary_color: '#B45309',
        welcome_message:
          'This is a place to notice what actually happens, not to grade yourself. Honest beats impressive.',
        timezone: 'America/New_York',
        status: 'active',
        subscription_status: 'pilot',
        plan: 'coach',
        client_limit: 30,
        pilot_mode: true,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        trial_ends_at: null,
        created_at: addDays(today, -120) + 'T10:00:00.000Z',
        updated_at: now,
      },
    ],
    profiles: [
      {
        id: id('coach-claire'),
        auth_user_id: 'auth-coach-claire',
        organization_id: ORG_ID,
        role: 'organization_owner',
        first_name: 'Claire',
        last_name: 'Morgan',
        email: 'claire@clairecoaching.demo',
        avatar_url: null,
        timezone: 'America/New_York',
        status: 'active',
        last_active_at: now,
        created_at: addDays(today, -120) + 'T10:00:00.000Z',
        updated_at: now,
      },
    ],
    coach_client_assignments: [],
    frameworks: [
      {
        id: FRAMEWORK_ID,
        organization_id: ORG_ID,
        name: 'Pause · Notice · Choose',
        description: 'A short reflective loop for moments where intention and behaviour come apart.',
        status: 'active',
        version: 1,
        is_default: true,
        created_at: addDays(today, -120) + 'T10:00:00.000Z',
        updated_at: now,
      },
    ],
    framework_steps: FRAMEWORK_STEPS.map((step, index) => ({
      id: id(`step-${index}`),
      framework_id: FRAMEWORK_ID,
      organization_id: ORG_ID,
      title: step.title,
      description: step.description || null,
      step_order: index,
      input_type: step.input_type,
      required: step.required,
      configuration_json: step.configuration_json ?? {},
      ai_analysis_enabled: true,
      created_at: now,
      updated_at: now,
    })),
    exercises: [
      {
        id: EXERCISE_ID,
        organization_id: ORG_ID,
        framework_id: FRAMEWORK_ID,
        name: 'Daily Reflection',
        description: 'Two minutes on what happened today, ending with tomorrow’s commitment.',
        frequency: 'daily',
        prompts_commitment: true,
        active: true,
        created_at: addDays(today, -120) + 'T10:00:00.000Z',
        updated_at: now,
      },
    ],
    exercise_assignments: [],
    exercise_entries: [],
    exercise_responses: [],
    reason_codes: REASONS.map((reason, index) => ({
      id: id(id(`reason-${reason.slug}`)),
      organization_id: ORG_ID,
      name: reason.name,
      slug: reason.slug,
      category: reason.category,
      sort_order: index * 10,
      active: true,
      created_at: now,
    })),
    commitments: [],
    commitment_checkins: [],
    commitment_facts: [],
    patterns: [],
    coach_alerts: [],
    client_status_snapshots: [],
    coaching_briefs: [],
    experiments: [],
    coach_notes: [],
    organization_ai_settings: [
      {
        id: id('ai-settings-1'),
        organization_id: ORG_ID,
        coach_philosophy:
          'Encourage curiosity rather than shame. Behaviour is information about conditions, not a verdict on the person.',
        preferred_language: 'en',
        preferred_tone: 'calm, direct, warm, never moralising',
        preferred_terminology_json: { goals: 'experiments', 'weigh-in': 'check-in' },
        forbidden_topics_json: ['calorie targets', 'weight goals'],
        system_guidelines: 'Ask short reflective questions. Never suggest a diet or a training plan.',
        created_at: now,
        updated_at: now,
      },
    ],
    client_preferences: [],
    client_insights: [],
    client_experiments: [],
    invitations: [],
    audit_logs: [],
    ai_usage_events: [],
  };

  let commitmentSeq = 0;

  for (const spec of CLIENTS) {
    const random = rng(spec.seed);

    tables.profiles.push({
      id: spec.id,
      auth_user_id: `auth-${spec.key}`,
      organization_id: ORG_ID,
      role: 'client',
      first_name: spec.firstName,
      last_name: spec.lastName,
      email: spec.email,
      avatar_url: null,
      timezone: 'America/New_York',
      status: 'active',
      last_active_at: now,
      created_at: addDays(today, -DAYS) + 'T10:00:00.000Z',
      updated_at: now,
    });

    tables.coach_client_assignments.push({
      id: id(`cca-${spec.id}`),
      organization_id: ORG_ID,
      coach_id: id('coach-claire'),
      client_id: spec.id,
      is_primary: true,
      created_at: now,
    });

    tables.client_preferences.push({
      id: id(`prefs-${spec.key}`),
      organization_id: ORG_ID,
      client_id: spec.id,
      notification_preferences: { morning: true, when_due: true, evening_nudge: true, weekly: true },
      preferred_checkin_time: '19:00',
      timezone: 'America/New_York',
      onboarding_complete: true,
      created_at: now,
      updated_at: now,
    });

    tables.exercise_assignments.push({
      id: id(`ea-${spec.id}`),
      organization_id: ORG_ID,
      exercise_id: EXERCISE_ID,
      client_id: spec.id,
      assigned_by: id('coach-claire'),
      start_date: addDays(today, -DAYS),
      end_date: null,
      schedule_json: {},
      active: true,
      created_at: now,
    });

    // --- commitments and check-ins ---------------------------------------
    for (let daysAgo = DAYS - 1; daysAgo >= 1; daysAgo -= 1) {
      const date = addDays(today, -daysAgo);
      const plan = spec.plan(daysAgo, date, random, spec.commitments);
      if (random() < 0.12) continue; // real people skip days

      commitmentSeq += 1;
      const commitmentId = id(`commitment-${commitmentSeq}`);
      const status = statusFor(plan.outcome);
      const reason = plan.reasonSlug ? REASONS.find((r) => r.slug === plan.reasonSlug) : null;

      tables.commitments.push({
        id: commitmentId,
        organization_id: ORG_ID,
        client_id: spec.id,
        source_entry_id: null,
        commitment_text: plan.text,
        commitment_category: null,
        commitment_date: date,
        due_at: `${date}T23:00:00.000Z`,
        confidence_score: plan.confidence,
        status,
        created_hour_local: plan.createdHour,
        created_at: `${addDays(date, -1)}T${String(plan.createdHour).padStart(2, '0')}:30:00.000Z`,
        updated_at: now,
      });

      tables.commitment_checkins.push({
        id: id(`checkin-${commitmentSeq}`),
        organization_id: ORG_ID,
        commitment_id: commitmentId,
        client_id: spec.id,
        outcome: plan.outcome,
        reason_code_id: reason ? id(`reason-${reason.slug}`) : null,
        reason_text: null,
        emotion: null,
        context_json: {},
        checked_in_at: `${addDays(date, 1)}T08:15:00.000Z`,
        created_at: now,
      });
    }

    // One open commitment for today, so the client's Today screen has
    // something waiting rather than being empty on first view.
    commitmentSeq += 1;
    tables.commitments.push({
      id: id(`commitment-${commitmentSeq}`),
      organization_id: ORG_ID,
      client_id: spec.id,
      source_entry_id: null,
      commitment_text: pick(random, spec.commitments),
      commitment_category: null,
      commitment_date: today,
      due_at: `${today}T23:00:00.000Z`,
      confidence_score: 70 + Math.floor(random() * 20),
      status: 'planned',
      created_hour_local: 8,
      created_at: `${today}T08:30:00.000Z`,
      updated_at: now,
    });

    // --- reflections -------------------------------------------------------
    for (let daysAgo = 30; daysAgo >= 1; daysAgo -= 1) {
      const date = addDays(today, -daysAgo);
      const completed = random() < (spec.firstName === 'Sarah' ? 0.62 : 0.85);
      const entryId = id(`entry-${spec.id}-${daysAgo}`);

      tables.exercise_entries.push({
        id: entryId,
        organization_id: ORG_ID,
        client_id: spec.id,
        exercise_id: EXERCISE_ID,
        entry_date: date,
        started_at: `${date}T20:00:00.000Z`,
        completed_at: completed ? `${date}T20:04:00.000Z` : null,
        status: completed ? 'completed' : 'abandoned',
        created_at: now,
      });

      if (!completed) continue;

      const answers = pick(random, REFLECTIONS);
      answers.forEach((answer, index) => {
        tables.exercise_responses.push({
          id: id(`response-${entryId}-${index}`),
          organization_id: ORG_ID,
          entry_id: entryId,
          framework_step_id: id(`step-${index}`),
          response_text: answer,
          response_number: null,
          response_json: null,
          created_at: now,
        });
      });
      tables.exercise_responses.push({
        id: id(`response-${entryId}-4`),
        organization_id: ORG_ID,
        entry_id: entryId,
        framework_step_id: id('step-4'),
        response_text: null,
        response_number: 3 + Math.floor(random() * 6),
        response_json: null,
        created_at: now,
      });
    }
  }

  // --- the commitment_facts view ------------------------------------------
  rebuildFacts(tables);

  // --- experiments ---------------------------------------------------------
  tables.experiments.push(
    {
      id: id('experiment-jessica'),
      organization_id: ORG_ID,
      client_id: id('client-jessica'),
      pattern_id: null,
      title: 'Weekend commitments, half the size',
      hypothesis:
        'Weekend plans are written as if the weekend runs like a weekday, so they collide with everything else that is happening.',
      intervention:
        'For two weeks, Saturday and Sunday commitments are half the size of weekday ones and set on Friday.',
      metric_key: 'follow_through',
      baseline_metric: 0.31,
      baseline_window_days: 14,
      start_date: addDays(today, -6),
      end_date: addDays(today, 8),
      status: 'active',
      result_metric: null,
      result_summary: null,
      created_by: id('coach-claire'),
      created_at: now,
      updated_at: now,
    },
    {
      id: id('experiment-rachel'),
      organization_id: ORG_ID,
      client_id: id('client-rachel'),
      pattern_id: null,
      title: 'A planned afternoon snack',
      hypothesis:
        'Late-afternoon hunger appears alongside most changed dinner plans, so the dinner plan may be failing hours before dinner.',
      intervention: 'Add a planned snack at 4pm for seven days and keep everything else the same.',
      metric_key: 'follow_through',
      baseline_metric: 0.53,
      baseline_window_days: 14,
      start_date: addDays(today, -28),
      end_date: addDays(today, -21),
      status: 'completed',
      result_metric: 0.74,
      result_summary:
        'Follow-through moved from 53% to 74% across 19 commitments during the experiment window.',
      created_by: id('coach-claire'),
      created_at: now,
      updated_at: now,
    },
  );

  tables.coach_notes.push({
    id: id('note-sarah-1'),
    organization_id: ORG_ID,
    client_id: id('client-sarah'),
    author_id: id('coach-claire'),
    body: 'Mentioned a reorganisation at work on our last call. Worth checking whether that is still running.',
    created_at: addDays(today, -9) + 'T15:00:00.000Z',
    updated_at: now,
  });

  // --- run the real engines over the data ----------------------------------
  runIntelligence(tables, today);

  return tables;
}

/** Recomputes the commitment_facts view rows from commitments + check-ins. */
export function rebuildFacts(tables: Tables) {
  const checkinByCommitment = new Map<string, Row>();
  for (const checkin of tables.commitment_checkins) {
    checkinByCommitment.set(checkin.commitment_id as string, checkin);
  }
  const reasonById = new Map(tables.reason_codes.map((reason) => [reason.id as string, reason]));

  tables.commitment_facts = tables.commitments.map((commitment) => {
    const checkin = checkinByCommitment.get(commitment.id as string);
    const reason = checkin?.reason_code_id
      ? reasonById.get(checkin.reason_code_id as string)
      : undefined;
    const date = commitment.commitment_date as string;

    return {
      commitment_id: commitment.id,
      organization_id: commitment.organization_id,
      client_id: commitment.client_id,
      commitment_text: commitment.commitment_text,
      commitment_category: commitment.commitment_category,
      commitment_date: date,
      due_at: commitment.due_at,
      confidence_score: commitment.confidence_score,
      status: commitment.status,
      created_at: commitment.created_at,
      created_hour_local: commitment.created_hour_local,
      weekday: isoWeekday(date),
      is_weekend: isoWeekday(date) >= 6,
      outcome: checkin?.outcome ?? null,
      checked_in_at: checkin?.checked_in_at ?? null,
      emotion: checkin?.emotion ?? null,
      reason_code_id: checkin?.reason_code_id ?? null,
      reason_slug: reason?.slug ?? null,
      reason_name: reason?.name ?? null,
      reason_category: reason?.category ?? null,
    };
  });
}

/**
 * The nightly job's work, in memory: stored patterns, open alerts, risk
 * snapshots and a coaching brief — all produced by the production engines.
 */
function runIntelligence(tables: Tables, today: string) {
  const now = new Date().toISOString();
  tables.patterns = [];
  tables.coach_alerts = [];
  tables.client_status_snapshots = [];

  for (const spec of CLIENTS) {
    const facts = tables.commitment_facts.filter(
      (fact) => fact.client_id === spec.id,
    ) as unknown as CommitmentFact[];
    const entries = tables.exercise_entries.filter((entry) => entry.client_id === spec.id) as {
      entry_date: string;
      status: 'started' | 'completed' | 'abandoned';
    }[];

    const metrics = computeClientMetrics({
      facts,
      referenceDate: today,
      exerciseEntries: entries,
      lastActivityAt: now,
    });
    const detected = detectPatterns(facts, { referenceDate: today });
    const experiments = tables.experiments.filter((e) => e.client_id === spec.id);

    detected.forEach((candidate, index) => {
      tables.patterns.push({
        id: id(`pattern-${spec.id}-${index}`),
        organization_id: ORG_ID,
        client_id: spec.id,
        pattern_type: candidate.patternType,
        pattern_key: candidate.patternKey,
        title: candidate.title,
        description: candidate.description,
        confidence_score: candidate.confidence,
        evidence_json: candidate.evidence,
        ai_explanation: null,
        suggested_question: candidate.suggestedQuestion,
        suggested_experiment: candidate.suggestedExperiment,
        first_detected_at: now,
        last_detected_at: now,
        status: index === 0 ? 'active' : 'candidate',
        created_at: now,
        updated_at: now,
      });
    });

    const alerts = generateAlerts({
      metrics,
      patterns: detected,
      experiments: experiments as never,
    });

    alerts.forEach((alert, index) => {
      tables.coach_alerts.push({
        id: id(`alert-${spec.id}-${index}`),
        organization_id: ORG_ID,
        client_id: spec.id,
        alert_type: alert.alertType,
        alert_key: alert.alertKey,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        recommended_action: alert.recommendedAction,
        evidence_json: alert.evidence,
        created_at: now,
        resolved_at: null,
        resolved_by: null,
      });
    });

    const risk = assessRisk({
      metrics,
      openHighSeverityAlerts: alerts.filter((a) => a.severity === 'high').length,
      activePatterns: detected.length,
    });

    tables.client_status_snapshots.push({
      id: id(`snapshot-${spec.id}`),
      organization_id: ORG_ID,
      client_id: spec.id,
      as_of: today,
      risk_level: risk.level,
      risk_reasons_json: risk.reasons.map((reason) => reason.label),
      follow_through_7: metrics.followThrough7.rate,
      follow_through_30: metrics.followThrough30.rate,
      follow_through_90: metrics.followThrough90.rate,
      follow_through_prev_30: metrics.followThroughPrev30.rate,
      trend: metrics.trend,
      confidence_avg: metrics.confidenceAverage,
      calibration_gap: metrics.calibration.gap,
      exercise_completion_30: metrics.exerciseCompletion30,
      open_commitments: metrics.openCommitments,
      overdue_checkins: metrics.overdueCheckins,
      days_since_activity: metrics.daysSinceLastActivity,
      metrics_json: {},
      created_at: now,
    });

    // A brief for Sarah, so the demo shows one without needing an API key.
    if (spec.id === id('client-sarah')) {
      const brief = composeBriefDeterministic({
        clientFirstName: 'Sarah',
        metrics,
        patterns: detected,
        periodStart: addDays(today, -29),
        periodEnd: today,
        organizationId: ORG_ID,
        aiSettings: null,
      });

      tables.coaching_briefs.push({
        id: id('brief-sarah'),
        organization_id: ORG_ID,
        client_id: spec.id,
        period_start: addDays(today, -29),
        period_end: today,
        headline: brief.headline,
        summary: brief.summary,
        metrics_json: {},
        patterns_json: brief.keyObservations,
        suggested_questions_json: brief.suggestedQuestions,
        suggested_experiment: brief.suggestedExperiment,
        model: null,
        generated_by: id('coach-claire'),
        generated_at: addDays(today, -1) + 'T09:00:00.000Z',
      });
    }
  }
}

/**
 * Built once per server process and mutated in place by demo writes, so a
 * commitment made in the demo is still there on the next page load.
 *
 * It hangs off globalThis rather than a module-level variable because Next
 * loads server actions and page renders through separate module registries in
 * development. A per-module cache gives each of them its own copy of the
 * data — writes land in one and reads come from another, which looks exactly
 * like a write that silently did nothing.
 */
const DEMO_STORE = Symbol.for('nell.demo.tables');
type GlobalWithDemo = typeof globalThis & { [DEMO_STORE]?: Tables };

export function demoTables(): Tables {
  const store = globalThis as GlobalWithDemo;
  store[DEMO_STORE] ??= build();
  return store[DEMO_STORE];
}

export const DEMO_USERS = [
  { authUserId: 'auth-coach-claire', name: 'Claire Morgan', role: 'Coach — owns the workspace', email: 'claire@clairecoaching.demo' },
  { authUserId: 'auth-client-sarah', name: 'Sarah Miller', role: 'Client — follow-through declining', email: 'sarah@clairecoaching.demo' },
  { authUserId: 'auth-client-jessica', name: 'Jessica Lane', role: 'Client — weekend dip', email: 'jessica@clairecoaching.demo' },
  { authUserId: 'auth-client-amanda', name: 'Amanda Brooks', role: 'Client — steady', email: 'amanda@clairecoaching.demo' },
  { authUserId: 'auth-client-rachel', name: 'Rachel Cole', role: 'Client — overconfident planner', email: 'rachel@clairecoaching.demo' },
];
