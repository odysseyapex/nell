'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requireOwner } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type OnboardingStep, nextOnboardingPath } from '@/lib/onboarding';
import type { StepInputType } from '@/lib/types';

/**
 * Onboarding.
 *
 * The order matters: a coach describes their own method before Nellvia asks them
 * to invite anyone, because a framework built after the first client has
 * already started is a framework that gets abandoned.
 *
 * Nothing here writes a coaching methodology of its own. The starter templates
 * are offered as editable text, and every step can be rewritten afterwards.
 */

export interface ActionState {
  error?: string;
  message?: string;
}


// ---------------------------------------------------------------------------

const OrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Enter your business name').max(120),
  timezone: z.string().trim().min(1).max(64),
});

export async function saveOrganizationStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireOwner();
  const parsed = OrganizationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('organizations')
    .update({ name: parsed.data.name, timezone: parsed.data.timezone })
    .eq('id', organization.id);

  if (error) return { error: 'Could not save that.' };

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'organization.updated',
    entityType: 'organization',
    entityId: organization.id,
  });

  redirect(nextOnboardingPath('organization'));
}

// ---------------------------------------------------------------------------

const BrandingSchema = z.object({
  primaryColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/, 'Use a hex colour like #1F2937'),
  secondaryColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/, 'Use a hex colour like #0EA5A4'),
  welcomeMessage: z.string().trim().max(600).optional(),
  logoUrl: z.string().trim().url('Enter a valid URL').optional().or(z.literal('')),
  redirectTo: z.string().optional(),
});

export async function saveBrandingStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireOwner();
  const parsed = BrandingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('organizations')
    .update({
      primary_color: parsed.data.primaryColor.startsWith('#')
        ? parsed.data.primaryColor
        : `#${parsed.data.primaryColor}`,
      secondary_color: parsed.data.secondaryColor.startsWith('#')
        ? parsed.data.secondaryColor
        : `#${parsed.data.secondaryColor}`,
      welcome_message: parsed.data.welcomeMessage || null,
      logo_url: parsed.data.logoUrl || null,
    })
    .eq('id', organization.id);

  if (error) return { error: 'Could not save branding.' };

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'branding.updated',
    entityType: 'organization',
    entityId: organization.id,
  });

  if (parsed.data.redirectTo) {
    revalidatePath(parsed.data.redirectTo);
    return { message: 'Branding saved.' };
  }
  redirect(nextOnboardingPath('branding'));
}

// ---------------------------------------------------------------------------

const MethodSchema = z.object({
  coachPhilosophy: z.string().trim().max(2000).optional(),
  preferredTone: z.string().trim().max(200).optional(),
  systemGuidelines: z.string().trim().max(2000).optional(),
  terminology: z.string().trim().max(1000).optional(),
  forbiddenTopics: z.string().trim().max(1000).optional(),
  redirectTo: z.string().optional(),
});

/** "goals=experiments, weigh-in=check-in" → { goals: 'experiments', ... } */
function parseTerminology(input: string | undefined): Record<string, string> {
  if (!input) return {};
  const map: Record<string, string> = {};
  for (const pair of input.split(/[\n,]/)) {
    const [from, to] = pair.split('=').map((part) => part.trim());
    if (from && to) map[from] = to;
  }
  return map;
}

export async function saveMethodStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireOwner();
  const parsed = MethodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('organization_ai_settings').upsert(
    {
      organization_id: organization.id,
      coach_philosophy: parsed.data.coachPhilosophy || null,
      preferred_tone: parsed.data.preferredTone || 'calm, curious, non-judgemental',
      system_guidelines: parsed.data.systemGuidelines || null,
      preferred_terminology_json: parseTerminology(parsed.data.terminology),
      forbidden_topics_json: (parsed.data.forbiddenTopics ?? '')
        .split(/[\n,]/)
        .map((topic) => topic.trim())
        .filter(Boolean),
    },
    { onConflict: 'organization_id' },
  );

  if (error) {
    console.error('[onboarding] ai settings failed', error.message);
    return { error: 'Could not save your coaching method.' };
  }

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'ai_settings.updated',
    entityType: 'organization',
    entityId: organization.id,
  });

  if (parsed.data.redirectTo) {
    revalidatePath(parsed.data.redirectTo);
    return { message: 'Saved.' };
  }
  redirect(nextOnboardingPath('method'));
}

// ---------------------------------------------------------------------------

const StepSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  inputType: z.enum([
    'short_text',
    'long_text',
    'number',
    'slider',
    'yes_no',
    'single_select',
    'multi_select',
    'scale',
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string().max(120)).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const FrameworkSchema = z.object({
  frameworkId: z.string().uuid().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Give your framework a name').max(120),
  description: z.string().trim().max(600).optional(),
  publish: z.boolean().default(true),
  steps: z.array(StepSchema).min(1, 'Add at least one step').max(20),
});

/**
 * Saves a framework and its ordered steps.
 *
 * Steps are replaced wholesale rather than diffed. Historical responses point
 * at step ids, so replacing them would orphan past answers — which is why
 * publishing bumps the version and existing steps are updated in place where
 * they still exist.
 */
export async function saveFramework(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireOwner();

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('payload') ?? '{}'));
  } catch {
    return { error: 'Could not read that framework.' };
  }

  const parsed = FrameworkSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the framework and try again' };
  }

  const supabase = await createSupabaseServerClient();
  const status = parsed.data.publish ? 'active' : 'draft';
  let frameworkId = parsed.data.frameworkId || null;

  if (frameworkId) {
    const { error } = await supabase
      .from('frameworks')
      .update({ name: parsed.data.name, description: parsed.data.description || null, status })
      .eq('id', frameworkId);
    if (error) return { error: 'Could not update that framework.' };
  } else {
    const { data, error } = await supabase
      .from('frameworks')
      .insert({
        organization_id: organization.id,
        name: parsed.data.name,
        description: parsed.data.description || null,
        status,
        is_default: true,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) {
      console.error('[framework] create failed', error?.message);
      return { error: 'Could not create that framework.' };
    }
    frameworkId = data.id;
  }

  // Existing steps are removed and rewritten in order. Responses reference
  // step ids with ON DELETE CASCADE, so this is only safe before a framework
  // has been used; published frameworks are versioned instead.
  const { data: existingSteps } = await supabase
    .from('framework_steps')
    .select('id')
    .eq('framework_id', frameworkId);

  if (existingSteps && existingSteps.length > 0) {
    const { count } = await supabase
      .from('exercise_responses')
      .select('id', { count: 'exact', head: true })
      .in(
        'framework_step_id',
        existingSteps.map((step: { id: string }) => step.id),
      );

    if ((count ?? 0) > 0) {
      // Someone has already answered these questions. Bump the version rather
      // than deleting the steps their answers point at.
      const { data: framework } = await supabase
        .from('frameworks')
        .select('version')
        .eq('id', frameworkId)
        .maybeSingle<{ version: number }>();

      await supabase
        .from('frameworks')
        .update({ version: (framework?.version ?? 1) + 1 })
        .eq('id', frameworkId);
    } else {
      await supabase.from('framework_steps').delete().eq('framework_id', frameworkId);
    }
  }

  const rows = parsed.data.steps.map((step, index) => ({
    framework_id: frameworkId,
    organization_id: organization.id,
    title: step.title,
    description: step.description || null,
    step_order: index,
    input_type: step.inputType as StepInputType,
    required: step.required,
    configuration_json: {
      ...(step.options?.length ? { options: step.options } : {}),
      ...(step.min !== undefined ? { min: step.min } : {}),
      ...(step.max !== undefined ? { max: step.max } : {}),
    },
  }));

  const { error: stepsError } = await supabase.from('framework_steps').insert(rows);
  if (stepsError) {
    console.error('[framework] steps failed', stepsError.message);
    return { error: 'The framework was saved but its steps were not.' };
  }

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: parsed.data.publish ? 'framework.published' : 'framework.updated',
    entityType: 'framework',
    entityId: frameworkId ?? undefined,
    metadata: { steps: rows.length },
  });

  revalidatePath('/app/settings/framework');
  return { message: parsed.data.publish ? 'Framework published.' : 'Draft saved.' };
}

// ---------------------------------------------------------------------------

const ExerciseSchema = z.object({
  name: z.string().trim().min(2, 'Name this exercise').max(120),
  description: z.string().trim().max(600).optional(),
  frequency: z.enum(['daily', 'weekly', 'manual', 'custom']),
  promptsCommitment: z.coerce.boolean().default(false),
  redirectTo: z.string().optional(),
});

export async function createExercise(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireOwner();
  const parsed = ExerciseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form' };

  const supabase = await createSupabaseServerClient();
  const { data: framework } = await supabase
    .from('frameworks')
    .select('id')
    .eq('status', 'active')
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!framework) {
    return { error: 'Publish a framework first — an exercise is a framework in use.' };
  }

  const { data: exercise, error } = await supabase
    .from('exercises')
    .insert({
      organization_id: organization.id,
      framework_id: framework.id,
      name: parsed.data.name,
      description: parsed.data.description || null,
      frequency: parsed.data.frequency,
      prompts_commitment: parsed.data.promptsCommitment,
      active: true,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !exercise) {
    console.error('[exercise] create failed', error?.message);
    return { error: 'Could not create that exercise.' };
  }

  // Any client already in the workspace gets the new exercise straight away.
  const { data: clients } = await supabase.from('profiles').select('id').eq('role', 'client');
  if (clients && clients.length > 0) {
    await supabase.from('exercise_assignments').upsert(
      clients.map((client: { id: string }) => ({
        organization_id: organization.id,
        exercise_id: exercise.id,
        client_id: client.id,
        assigned_by: profile.id,
      })),
      { onConflict: 'exercise_id,client_id' },
    );
  }

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'exercise.created',
    entityType: 'exercise',
    entityId: exercise.id,
  });

  if (parsed.data.redirectTo) {
    revalidatePath(parsed.data.redirectTo);
    return { message: 'Exercise created.' };
  }
  redirect(nextOnboardingPath('exercise'));
}

// ---------------------------------------------------------------------------

const ReasonCodesSchema = z.object({
  added: z.array(z.string().trim().min(1).max(80)).max(20),
  deactivated: z.array(z.string().uuid()).max(50),
  redirectTo: z.string().optional(),
});

export async function saveReasonCodes(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireOwner();

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('payload') ?? '{}'));
  } catch {
    return { error: 'Could not read those reasons.' };
  }

  const parsed = ReasonCodesSchema.safeParse(payload);
  if (!parsed.success) return { error: 'Could not save those reasons.' };

  const supabase = await createSupabaseServerClient();

  if (parsed.data.deactivated.length > 0) {
    // Deactivated rather than deleted: past check-ins still point at them, and
    // a reason that disappears would silently rewrite history.
    await supabase.from('reason_codes').update({ active: false }).in('id', parsed.data.deactivated);
  }

  if (parsed.data.added.length > 0) {
    await supabase.from('reason_codes').insert(
      parsed.data.added.map((name, index) => ({
        organization_id: organization.id,
        name,
        slug: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50),
        category: 'custom',
        sort_order: 200 + index,
      })),
    );
  }

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'reason_codes.updated',
    entityType: 'organization',
    entityId: organization.id,
  });

  if (parsed.data.redirectTo) {
    revalidatePath(parsed.data.redirectTo);
    return { message: 'Reasons updated.' };
  }
  redirect(nextOnboardingPath('reasons'));
}

export async function finishOnboarding(): Promise<void> {
  await requireOwner();
  redirect('/app/coach');
}
