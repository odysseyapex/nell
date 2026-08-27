/**
 * Demo seed: Claire Coaching.
 *
 * Builds a workspace whose numbers tell four different, recognisable stories,
 * so a coach evaluating Nellvia sees the product working rather than a screen of
 * placeholder rows:
 *
 *   Sarah Miller    follow-through falling; work stress dominates recent misses
 *   Jessica Lane    strong on weekdays, falls away at weekends
 *   Amanda Brooks   consistently high — the "nothing to do here" case
 *   Rachel Cole     predicts ~90% confidence, delivers around 60%
 *
 * The data is generated from a fixed seed, so every run produces exactly the
 * same history and the demo never drifts. Ninety days are generated because
 * trend detection compares the last 30 days against the 30 before them — a
 * month of data can show a rate but cannot show a change.
 *
 * Usage:  npm run db:seed          (creates or tops up)
 *         npm run db:reset         (deletes the demo org first)
 */

import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config({ path: '.env' });

import { composeBriefDeterministic } from '../src/lib/ai/brief';
import { computeClientMetrics } from '../src/lib/metrics';
import { addDays, isoWeekday } from '../src/lib/metrics/dates';
import { detectPatterns } from '../src/lib/patterns/engine';
import { runNightlyIntelligence } from '../src/lib/jobs/nightly';
import type { CheckinOutcome, CommitmentFact } from '../src/lib/types';

const ORG_SLUG = 'claire-coaching';
const DEMO_PASSWORD = 'nell-demo-2026';
const DAYS = 90;

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and identical across runs for a given seed. */
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

// ---------------------------------------------------------------------------
// Client behaviour profiles
// ---------------------------------------------------------------------------

interface DayPlan {
  outcome: CheckinOutcome;
  reasonSlug: string | null;
  confidence: number;
  createdHour: number;
  text: string;
}

interface ClientSpec {
  firstName: string;
  lastName: string;
  email: string;
  seed: number;
  commitments: string[];
  /** daysAgo counts backwards from today: 0 is today, 89 is the oldest day. */
  plan: (daysAgo: number, date: string, random: () => number, texts: string[]) => DayPlan | null;
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

const CLIENTS: ClientSpec[] = [
  {
    firstName: 'Sarah',
    lastName: 'Miller',
    email: 'sarah@clairecoaching.demo',
    seed: 1001,
    commitments: [...WALKING, ...EATING],
    /**
     * Strong for two months, then a clear decline in the last four weeks, with
     * work stress attached to most of the recent misses. This is the client
     * the "Needs attention" dashboard exists for.
     */
    plan: (daysAgo, _date, random, texts) => {
      const recent = daysAgo <= 30;
      const veryRecent = daysAgo <= 14;
      const successRate = recent ? (veryRecent ? 0.45 : 0.6) : 0.84;
      const success = random() < successRate;

      if (success) {
        return {
          outcome: 'completed',
          reasonSlug: null,
          confidence: 75 + Math.floor(random() * 15),
          createdHour: 8 + Math.floor(random() * 3),
          text: pick(random, texts),
        };
      }

      // In the recent window, work stress crowds out the other reasons.
      // Her story is a stressful month at work, so stress dominates the recent
      // window and is absent from the older one. That contrast is what the
      // 30-day reason rule is meant to catch.
      const reason = recent
        ? random() < 0.68
          ? 'stress'
          : pick(random, ['time', 'low-energy', 'schedule-change'])
        : pick(random, ['time', 'forgot', 'social-situation', 'low-energy']);

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
    firstName: 'Jessica',
    lastName: 'Lane',
    email: 'jessica@clairecoaching.demo',
    seed: 2002,
    commitments: [...EATING, ...EVENING],
    /** Reliable Monday to Friday, comes apart at weekends. */
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
    firstName: 'Amanda',
    lastName: 'Brooks',
    email: 'amanda@clairecoaching.demo',
    seed: 3003,
    commitments: [...WALKING, ...EVENING],
    /** The steady one. Nellvia should say almost nothing about her. */
    plan: (_daysAgo, _date, random, texts) => {
      const success = random() < 0.93;
      if (success) {
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
    firstName: 'Rachel',
    lastName: 'Cole',
    email: 'rachel@clairecoaching.demo',
    seed: 4004,
    commitments: [...EATING, ...WALKING],
    /**
     * Consistently confident, consistently around 60%. The calibration gap is
     * the whole point of this client — and it is invisible without a
     * prediction recorded before the behaviour.
     */
    plan: (_daysAgo, _date, random, texts) => {
      const success = random() < 0.58;
      const confidence = 88 + Math.floor(random() * 10);

      if (success) {
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

const FRAMEWORK_STEPS = [
  {
    title: 'Pause — what happened?',
    description: 'Describe the moment plainly, before the explanation arrives.',
    input_type: 'long_text',
    required: true,
  },
  {
    title: 'Notice — what were you thinking?',
    description: 'The thought as it turned up, not the tidied version.',
    input_type: 'long_text',
    required: false,
  },
  {
    title: 'How did you feel?',
    description: '',
    input_type: 'short_text',
    required: false,
  },
  {
    title: 'Choose — what did you do?',
    description: '',
    input_type: 'long_text',
    required: true,
  },
  {
    title: 'Review — how settled do you feel about it?',
    description: '',
    input_type: 'scale',
    required: false,
    configuration_json: { min: 1, max: 10, minLabel: 'Unsettled', maxLabel: 'Settled' },
  },
];

const REFLECTION_ANSWERS = [
  ['Long day, got home late and the plan felt impossible.', 'This always happens on Thursdays.', 'Flat', 'Ordered in instead.'],
  ['Went for the walk even though I did not want to.', 'Just get out of the door.', 'Surprised', 'Walked the full loop.'],
  ['Skipped it after a difficult call at work.', 'I will do it tomorrow.', 'Frustrated', 'Stayed on the sofa.'],
  ['Prepped everything the night before.', 'It is already done, so I may as well.', 'Calm', 'Followed the plan.'],
  ['Meant to go, then a friend called.', 'I can move it.', 'Torn', 'Moved it and did not do it.'],
];

// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  Missing ${name}.\n  Copy .env.example to .env.local and fill in your Supabase values.\n`);
    process.exit(1);
  }
  return value;
}

async function ensureAuthUser(
  admin: SupabaseClient,
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });

  if (data?.user) return data.user.id;

  // Already exists — find them so the seed stays idempotent.
  if (error && /already/i.test(error.message)) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
  }

  throw new Error(`Could not create auth user ${email}: ${error?.message ?? 'unknown error'}`);
}

async function resetDemo(admin: SupabaseClient) {
  const { data: org } = await admin
    .from('organizations')
    .select('id')
    .eq('slug', ORG_SLUG)
    .maybeSingle<{ id: string }>();

  if (!org) return;

  const { data: profiles } = await admin
    .from('profiles')
    .select('auth_user_id')
    .eq('organization_id', org.id);

  // Deleting the organization cascades through every tenant table; the auth
  // users live outside those tables and are removed explicitly.
  await admin.from('organizations').delete().eq('id', org.id);

  for (const profile of (profiles ?? []) as { auth_user_id: string | null }[]) {
    if (profile.auth_user_id) {
      await admin.auth.admin.deleteUser(profile.auth_user_id).catch(() => undefined);
    }
  }

  console.log('  Removed the existing demo workspace.');
}

async function main() {
  const reset = process.argv.includes('--reset');

  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('\nSeeding Claire Coaching…\n');

  if (reset) await resetDemo(admin);

  const existing = await admin
    .from('organizations')
    .select('id')
    .eq('slug', ORG_SLUG)
    .maybeSingle<{ id: string }>();

  if (existing.data) {
    console.log('  The demo workspace already exists. Run `npm run db:reset` to rebuild it.\n');
    return;
  }

  // --- organization -------------------------------------------------------
  const { data: organization, error: orgError } = await admin
    .from('organizations')
    .insert({
      name: 'Claire Coaching',
      slug: ORG_SLUG,
      primary_color: '#0F766E',
      secondary_color: '#B45309',
      timezone: 'America/New_York',
      welcome_message:
        'This is a place to notice what actually happens, not to grade yourself. Honest beats impressive.',
      status: 'active',
      subscription_status: 'pilot',
      plan: 'coach',
      client_limit: 30,
      pilot_mode: true,
    })
    .select('id')
    .single<{ id: string }>();

  if (orgError || !organization) throw new Error(orgError?.message ?? 'organization insert failed');
  const orgId = organization.id;

  await admin.rpc('bootstrap_organization', { org: orgId });

  // --- coach --------------------------------------------------------------
  const coachAuthId = await ensureAuthUser(admin, 'claire@clairecoaching.demo', 'Claire', 'Morgan');
  const { data: coach } = await admin
    .from('profiles')
    .insert({
      auth_user_id: coachAuthId,
      organization_id: orgId,
      role: 'organization_owner',
      first_name: 'Claire',
      last_name: 'Morgan',
      email: 'claire@clairecoaching.demo',
      status: 'active',
      last_active_at: new Date().toISOString(),
    })
    .select('id')
    .single<{ id: string }>();

  if (!coach) throw new Error('coach profile insert failed');

  await admin.from('organization_ai_settings').upsert(
    {
      organization_id: orgId,
      coach_philosophy:
        'Encourage curiosity rather than shame. Behaviour is information about conditions, not a verdict on the person.',
      preferred_tone: 'calm, direct, warm, never moralising',
      preferred_terminology_json: { goals: 'experiments', 'weigh-in': 'check-in' },
      forbidden_topics_json: ['calorie targets', 'weight goals'],
      system_guidelines: 'Ask short reflective questions. Never suggest a diet or a training plan.',
    },
    { onConflict: 'organization_id' },
  );

  // --- framework ----------------------------------------------------------
  const { data: framework } = await admin
    .from('frameworks')
    .insert({
      organization_id: orgId,
      name: 'Pause · Notice · Choose',
      description: 'A short reflective loop for moments where intention and behaviour come apart.',
      status: 'active',
      is_default: true,
    })
    .select('id')
    .single<{ id: string }>();

  if (!framework) throw new Error('framework insert failed');

  const { data: steps } = await admin
    .from('framework_steps')
    .insert(
      FRAMEWORK_STEPS.map((step, index) => ({
        framework_id: framework.id,
        organization_id: orgId,
        title: step.title,
        description: step.description || null,
        step_order: index,
        input_type: step.input_type,
        required: step.required,
        configuration_json: step.configuration_json ?? {},
      })),
    )
    .select('id, step_order');

  const stepIds = ((steps ?? []) as { id: string; step_order: number }[])
    .sort((a, b) => a.step_order - b.step_order)
    .map((step) => step.id);

  const { data: exercise } = await admin
    .from('exercises')
    .insert({
      organization_id: orgId,
      framework_id: framework.id,
      name: 'Daily Reflection',
      description: 'Two minutes on what happened today, ending with tomorrow’s commitment.',
      frequency: 'daily',
      prompts_commitment: true,
      active: true,
    })
    .select('id')
    .single<{ id: string }>();

  if (!exercise) throw new Error('exercise insert failed');

  // --- reason codes lookup ------------------------------------------------
  const { data: reasonCodes } = await admin
    .from('reason_codes')
    .select('id, slug')
    .eq('organization_id', orgId);

  const reasonIdBySlug = new Map(
    ((reasonCodes ?? []) as { id: string; slug: string }[]).map((row) => [row.slug, row.id]),
  );

  // --- clients and history -------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);

  for (const spec of CLIENTS) {
    const random = rng(spec.seed);
    const authId = await ensureAuthUser(admin, spec.email, spec.firstName, spec.lastName);

    const { data: client } = await admin
      .from('profiles')
      .insert({
        auth_user_id: authId,
        organization_id: orgId,
        role: 'client',
        first_name: spec.firstName,
        last_name: spec.lastName,
        email: spec.email,
        status: 'active',
        timezone: 'America/New_York',
        last_active_at: new Date().toISOString(),
      })
      .select('id')
      .single<{ id: string }>();

    if (!client) throw new Error(`client insert failed for ${spec.email}`);

    await admin.from('coach_client_assignments').insert({
      organization_id: orgId,
      coach_id: coach.id,
      client_id: client.id,
    });

    await admin.from('exercise_assignments').insert({
      organization_id: orgId,
      exercise_id: exercise.id,
      client_id: client.id,
      assigned_by: coach.id,
      start_date: addDays(today, -DAYS),
    });

    const commitmentRows: Record<string, unknown>[] = [];
    const checkinPlans: { date: string; plan: DayPlan }[] = [];

    for (let daysAgo = DAYS - 1; daysAgo >= 1; daysAgo -= 1) {
      const date = addDays(today, -daysAgo);
      const plan = spec.plan(daysAgo, date, random, spec.commitments);
      if (!plan) continue;

      // Roughly one day in eight has no commitment at all — real people skip.
      if (random() < 0.12) continue;

      commitmentRows.push({
        organization_id: orgId,
        client_id: client.id,
        commitment_text: plan.text,
        commitment_date: date,
        due_at: `${date}T23:00:00Z`,
        confidence_score: plan.confidence,
        created_hour_local: plan.createdHour,
        status: 'planned',
        // Committed the evening before, which is what the timestamp should say.
        created_at: `${addDays(date, -1)}T${String(plan.createdHour).padStart(2, '0')}:30:00Z`,
      });
      checkinPlans.push({ date, plan });
    }

    const { data: insertedCommitments } = await admin
      .from('commitments')
      .insert(commitmentRows)
      .select('id, commitment_date');

    const commitmentByDate = new Map(
      ((insertedCommitments ?? []) as { id: string; commitment_date: string }[]).map((row) => [
        row.commitment_date,
        row.id,
      ]),
    );

    const checkinRows = checkinPlans
      .map(({ date, plan }) => {
        const commitmentId = commitmentByDate.get(date);
        if (!commitmentId) return null;
        return {
          organization_id: orgId,
          commitment_id: commitmentId,
          client_id: client.id,
          outcome: plan.outcome,
          reason_code_id: plan.reasonSlug ? (reasonIdBySlug.get(plan.reasonSlug) ?? null) : null,
          emotion: null,
          checked_in_at: `${addDays(date, 1)}T08:15:00Z`,
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    // The trigger on commitment_checkins moves each commitment's status.
    await admin.from('commitment_checkins').insert(checkinRows);

    // One open commitment for today, so the client's Today screen has
    // something waiting rather than being empty on first login.
    await admin.from('commitments').insert({
      organization_id: orgId,
      client_id: client.id,
      commitment_text: pick(random, spec.commitments),
      commitment_date: today,
      due_at: `${today}T23:00:00Z`,
      confidence_score: 70 + Math.floor(random() * 20),
      created_hour_local: 8,
      status: 'planned',
    });

    // --- reflections ------------------------------------------------------
    const entryRows: Record<string, unknown>[] = [];
    for (let daysAgo = 30; daysAgo >= 1; daysAgo -= 1) {
      const date = addDays(today, -daysAgo);
      const completed = random() < (spec.firstName === 'Sarah' ? 0.62 : 0.85);
      entryRows.push({
        organization_id: orgId,
        client_id: client.id,
        exercise_id: exercise.id,
        entry_date: date,
        started_at: `${date}T20:00:00Z`,
        completed_at: completed ? `${date}T20:04:00Z` : null,
        status: completed ? 'completed' : 'abandoned',
      });
    }

    const { data: insertedEntries } = await admin
      .from('exercise_entries')
      .insert(entryRows)
      .select('id, status');

    const responseRows: Record<string, unknown>[] = [];
    for (const entry of (insertedEntries ?? []) as { id: string; status: string }[]) {
      if (entry.status !== 'completed') continue;
      const answers = pick(random, REFLECTION_ANSWERS);
      answers.forEach((answer, index) => {
        if (!stepIds[index]) return;
        responseRows.push({
          organization_id: orgId,
          entry_id: entry.id,
          framework_step_id: stepIds[index],
          response_text: answer,
        });
      });
      if (stepIds[4]) {
        responseRows.push({
          organization_id: orgId,
          entry_id: entry.id,
          framework_step_id: stepIds[4],
          response_number: 3 + Math.floor(random() * 6),
        });
      }
    }

    if (responseRows.length > 0) {
      await admin.from('exercise_responses').insert(responseRows);
    }

    console.log(`  ${spec.firstName} ${spec.lastName}: ${commitmentRows.length} commitments`);
  }

  // --- experiments ---------------------------------------------------------
  const { data: clientRows } = await admin
    .from('profiles')
    .select('id, first_name')
    .eq('organization_id', orgId)
    .eq('role', 'client');

  const clientIdByName = new Map(
    ((clientRows ?? []) as { id: string; first_name: string }[]).map((row) => [row.first_name, row.id]),
  );

  const jessicaId = clientIdByName.get('Jessica');
  if (jessicaId) {
    await admin.from('experiments').insert({
      organization_id: orgId,
      client_id: jessicaId,
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
      created_by: coach.id,
    });
  }

  const rachelId = clientIdByName.get('Rachel');
  if (rachelId) {
    await admin.from('experiments').insert({
      organization_id: orgId,
      client_id: rachelId,
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
      created_by: coach.id,
    });
  }

  // --- a brief for Sarah, so the demo has one without needing an API key ---
  const sarahId = clientIdByName.get('Sarah');
  if (sarahId) {
    const { data: facts } = await admin
      .from('commitment_facts')
      .select('*')
      .eq('client_id', sarahId);

    const sarahFacts = (facts ?? []) as CommitmentFact[];
    const metrics = computeClientMetrics({ facts: sarahFacts, referenceDate: today });
    const patterns = detectPatterns(sarahFacts, { referenceDate: today });
    const brief = composeBriefDeterministic({
      clientFirstName: 'Sarah',
      metrics,
      patterns,
      periodStart: addDays(today, -29),
      periodEnd: today,
      organizationId: orgId,
      aiSettings: null,
    });

    await admin.from('coaching_briefs').insert({
      organization_id: orgId,
      client_id: sarahId,
      period_start: addDays(today, -29),
      period_end: today,
      headline: brief.headline,
      summary: brief.summary,
      metrics_json: {
        followThrough7: metrics.followThrough7,
        followThrough30: metrics.followThrough30,
        followThroughPrev30: metrics.followThroughPrev30,
        trend: metrics.trend,
        calibration: metrics.calibration,
      },
      patterns_json: brief.keyObservations,
      suggested_questions_json: brief.suggestedQuestions,
      suggested_experiment: brief.suggestedExperiment,
      generated_by: coach.id,
    });

    await admin.from('coach_notes').insert({
      organization_id: orgId,
      client_id: sarahId,
      author_id: coach.id,
      body: 'Mentioned a reorganisation at work on our last call. Worth checking whether that is still running.',
    });
  }

  // --- run the real nightly job so patterns and alerts are stored ----------
  console.log('\n  Running the nightly intelligence pass…');
  const result = await runNightlyIntelligence();
  console.log(
    `  ${result.patternsUpserted} patterns, ${result.alertsOpened} alerts, ${result.snapshots} snapshots.`,
  );
  if (result.errors.length > 0) console.log('  Errors:', result.errors);

  console.log(`
Done.

  Coach   claire@clairecoaching.demo
  Clients sarah@ / jessica@ / amanda@ / rachel@clairecoaching.demo
  Password for all of them: ${DEMO_PASSWORD}

  Sign in as Claire and open the dashboard.
`);
}

main().catch((error) => {
  console.error('\nSeeding failed:', error instanceof Error ? error.message : error, '\n');
  process.exit(1);
});
