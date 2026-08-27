'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireClient } from '@/lib/auth/session';
import { LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { hourIn, todayIn } from '@/lib/metrics/dates';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Commitment, ExerciseEntry } from '@/lib/types';

/**
 * Client-side (end user) mutations.
 *
 * These are the only writes that create the raw material Nellvia reasons over, so
 * they are strict about two things: a commitment always records the moment and
 * the confidence it was made with, and a check-in always records a structured
 * outcome rather than a free-text feeling about it.
 *
 * Authorization is by construction — every insert uses the caller's own
 * profile id, and RLS rejects any row whose client_id is not the caller.
 */

export interface ActionState {
  error?: string;
  message?: string;
}

async function touchActivity(profileId: string) {
  const supabase = await createSupabaseServerClient();
  await supabase
    .from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', profileId);
}

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

const CommitmentSchema = z.object({
  commitmentText: z.string().trim().min(3, 'Say what you are committing to').max(500),
  commitmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  confidence: z.coerce.number().int().min(0).max(100),
  anticipatedObstacle: z.string().trim().max(300).optional(),
  category: z.string().trim().max(80).optional(),
});

export async function createCommitment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, organization } = await requireClient();

  const parsed = CommitmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  }

  const limit = rateLimit(`commit:${profile.id}`, LIMITS.write.limit, LIMITS.write.windowMs);
  if (!limit.allowed) return { error: 'That is a lot of commitments at once. Take a breath.' };

  const timezone = profile.timezone ?? organization.timezone;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from('commitments').insert({
    organization_id: organization.id,
    client_id: profile.id,
    commitment_text: parsed.data.commitmentText,
    commitment_category: parsed.data.category || null,
    commitment_date: parsed.data.commitmentDate,
    due_at: `${parsed.data.commitmentDate}T23:59:59Z`,
    confidence_score: parsed.data.confidence,
    anticipated_obstacle: parsed.data.anticipatedObstacle || null,
    // Recorded at creation so "commitments made late at night" stays a cheap
    // query rather than a timezone conversion over every row.
    created_hour_local: hourIn(timezone),
    status: 'planned',
  });

  if (error) {
    console.error('[commitment] insert failed', error.message);
    return { error: 'Could not save that commitment.' };
  }

  await touchActivity(profile.id);
  revalidatePath('/app/client');
  revalidatePath('/app/client/commitments');
  return { message: 'Committed.' };
}

// ---------------------------------------------------------------------------
// Check-ins
// ---------------------------------------------------------------------------

const CheckinSchema = z.object({
  commitmentId: z.string().uuid(),
  outcome: z.enum([
    'completed',
    'changed_intentionally',
    'changed_impulsively',
    'circumstances_changed',
    'missed',
  ]),
  reasonCodeId: z.string().uuid().optional().or(z.literal('')),
  reasonText: z.string().trim().max(2000).optional(),
  emotion: z.string().trim().max(80).optional(),
});

export async function checkInCommitment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, organization } = await requireClient();

  const parsed = CheckinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose what happened' };
  }

  const supabase = await createSupabaseServerClient();

  // Read the commitment through RLS first: this both confirms ownership and
  // stops a second check-in silently overwriting the first.
  const { data: commitment } = await supabase
    .from('commitments')
    .select('id, client_id, status')
    .eq('id', parsed.data.commitmentId)
    .eq('client_id', profile.id)
    .maybeSingle<Pick<Commitment, 'id' | 'client_id' | 'status'>>();

  if (!commitment) return { error: 'That commitment is no longer available.' };

  const { error } = await supabase.from('commitment_checkins').insert({
    organization_id: organization.id,
    commitment_id: commitment.id,
    client_id: profile.id,
    outcome: parsed.data.outcome,
    reason_code_id: parsed.data.reasonCodeId || null,
    reason_text: parsed.data.reasonText || null,
    emotion: parsed.data.emotion || null,
    checked_in_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === '23505') return { error: 'You have already checked in on this one.' };
    console.error('[checkin] insert failed', error.message);
    return { error: 'Could not save that check-in.' };
  }

  // A database trigger moves commitments.status in step with the outcome, so
  // there is no second write to keep in sync here.
  await touchActivity(profile.id);
  revalidatePath('/app/client');
  revalidatePath('/app/client/commitments');
  revalidatePath('/app/client/insights');
  return { message: 'Recorded. Thank you for being honest about it.' };
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

/**
 * Opens an exercise.
 *
 * The entry is created when the client starts, not when they finish, so an
 * abandoned reflection is visible as abandoned. Recording only completions
 * would make exercise-completion metrics meaninglessly perfect.
 */
export async function startExercise(formData: FormData): Promise<void> {
  const { profile, organization } = await requireClient();

  const exerciseId = z.string().uuid().safeParse(formData.get('exerciseId'));
  if (!exerciseId.success) redirect('/app/client');

  const supabase = await createSupabaseServerClient();
  const today = todayIn(profile.timezone ?? organization.timezone);

  const { data: existing } = await supabase
    .from('exercise_entries')
    .select('id, status')
    .eq('client_id', profile.id)
    .eq('exercise_id', exerciseId.data)
    .eq('entry_date', today)
    .maybeSingle<Pick<ExerciseEntry, 'id' | 'status'>>();

  if (existing) redirect(`/app/client/exercise/${existing.id}`);

  const { data: entry, error } = await supabase
    .from('exercise_entries')
    .insert({
      organization_id: organization.id,
      client_id: profile.id,
      exercise_id: exerciseId.data,
      entry_date: today,
      status: 'started',
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !entry) {
    console.error('[exercise] could not start', error?.message);
    redirect('/app/client');
  }

  redirect(`/app/client/exercise/${entry.id}`);
}

const ResponseSchema = z.object({
  stepId: z.string().uuid(),
  text: z.string().max(8000).optional(),
  number: z.number().nullable().optional(),
  choices: z.array(z.string().max(200)).optional(),
});

const SubmitExerciseSchema = z.object({
  entryId: z.string().uuid(),
  responses: z.array(ResponseSchema),
});

export async function submitExercise(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, organization } = await requireClient();

  const raw = formData.get('payload');
  let payload: unknown;
  try {
    payload = JSON.parse(typeof raw === 'string' ? raw : '{}');
  } catch {
    return { error: 'Could not read those answers.' };
  }

  const parsed = SubmitExerciseSchema.safeParse(payload);
  if (!parsed.success) return { error: 'Some answers could not be saved. Please try again.' };

  const supabase = await createSupabaseServerClient();

  const { data: entry } = await supabase
    .from('exercise_entries')
    .select('id, client_id, status')
    .eq('id', parsed.data.entryId)
    .eq('client_id', profile.id)
    .maybeSingle<Pick<ExerciseEntry, 'id' | 'client_id' | 'status'>>();

  if (!entry) return { error: 'That reflection is no longer available.' };

  const rows = parsed.data.responses
    .filter((response) => {
      const hasText = (response.text ?? '').trim().length > 0;
      const hasNumber = response.number !== null && response.number !== undefined;
      const hasChoices = (response.choices ?? []).length > 0;
      return hasText || hasNumber || hasChoices;
    })
    .map((response) => ({
      organization_id: organization.id,
      entry_id: entry.id,
      framework_step_id: response.stepId,
      response_text: response.text?.trim() || null,
      response_number: response.number ?? null,
      response_json: response.choices?.length ? { choices: response.choices } : null,
    }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('exercise_responses')
      .upsert(rows, { onConflict: 'entry_id,framework_step_id' });

    if (error) {
      console.error('[exercise] responses failed', error.message);
      return { error: 'Could not save those answers.' };
    }
  }

  await supabase
    .from('exercise_entries')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', entry.id);

  await touchActivity(profile.id);
  revalidatePath('/app/client');
  revalidatePath('/app/client/history');
  return { message: 'Saved.' };
}

export async function abandonExercise(formData: FormData): Promise<void> {
  const { profile } = await requireClient();
  const entryId = z.string().uuid().safeParse(formData.get('entryId'));

  if (entryId.success) {
    const supabase = await createSupabaseServerClient();
    await supabase
      .from('exercise_entries')
      .update({ status: 'abandoned' })
      .eq('id', entryId.data)
      .eq('client_id', profile.id)
      .eq('status', 'started');
  }

  redirect('/app/client');
}

// ---------------------------------------------------------------------------
// Client preferences and onboarding
// ---------------------------------------------------------------------------

export async function completeClientOnboarding(): Promise<void> {
  const { profile, organization } = await requireClient();
  const supabase = await createSupabaseServerClient();

  await supabase.from('client_preferences').upsert(
    {
      organization_id: organization.id,
      client_id: profile.id,
      timezone: profile.timezone ?? organization.timezone,
      onboarding_complete: true,
    },
    { onConflict: 'client_id' },
  );

  revalidatePath('/app/client');
  redirect('/app/client');
}

const PreferencesSchema = z.object({
  preferredCheckinTime: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time'),
  morning: z.coerce.boolean().default(false),
  whenDue: z.coerce.boolean().default(false),
  eveningNudge: z.coerce.boolean().default(false),
  weekly: z.coerce.boolean().default(false),
});

export async function updateClientPreferences(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile, organization } = await requireClient();

  const parsed = PreferencesSchema.safeParse({
    preferredCheckinTime: formData.get('preferredCheckinTime'),
    morning: formData.get('morning') === 'on',
    whenDue: formData.get('whenDue') === 'on',
    eveningNudge: formData.get('eveningNudge') === 'on',
    weekly: formData.get('weekly') === 'on',
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('client_preferences').upsert(
    {
      organization_id: organization.id,
      client_id: profile.id,
      timezone: profile.timezone ?? organization.timezone,
      preferred_checkin_time: parsed.data.preferredCheckinTime,
      notification_preferences: {
        morning: parsed.data.morning,
        when_due: parsed.data.whenDue,
        evening_nudge: parsed.data.eveningNudge,
        weekly: parsed.data.weekly,
      },
    },
    { onConflict: 'client_id' },
  );

  if (error) return { error: 'Could not save those settings.' };

  revalidatePath('/app/client/settings');
  return { message: 'Saved.' };
}
