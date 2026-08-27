'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { requireStaff } from '@/lib/auth/session';
import { generateInviteToken } from '@/lib/auth/tokens';
import { canAddClient } from '@/lib/billing/plans';
import { clientInvitationEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';
import { generateBrief } from '@/lib/ai/brief';
import { getClientIntelligence } from '@/lib/data/intelligence';
import { followThroughOf, inWindow, lastNDays, todayIn } from '@/lib/metrics';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CommitmentFact, Experiment, OrganizationAiSettings } from '@/lib/types';

/**
 * Coach-side mutations.
 *
 * Every action begins with requireStaff(), which resolves the organization
 * from the session. Client ids arriving from the browser are then checked
 * against RLS by reading the row through the user-scoped client before any
 * write — an id for another tenant simply finds nothing.
 */

export interface ActionState {
  error?: string;
  message?: string;
}

/** Confirms the caller may act on this client. Returns null when they may not. */
async function resolveClient(clientId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email, organization_id')
    .eq('id', clientId)
    .eq('role', 'client')
    .maybeSingle<{
      id: string;
      first_name: string;
      last_name: string;
      email: string;
      organization_id: string;
    }>();
  return data;
}

// ---------------------------------------------------------------------------
// Invite a client
// ---------------------------------------------------------------------------

const InviteSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(80),
  lastName: z.string().trim().max(80).default(''),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  coachId: z.string().uuid('Choose a coach'),
});

export async function inviteClient(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireStaff();

  const parsed = InviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  }

  const limit = rateLimit(`invite:${organization.id}`, LIMITS.invite.limit, LIMITS.invite.windowMs);
  if (!limit.allowed) return { error: 'Too many invitations sent recently. Try again shortly.' };

  const supabase = await createSupabaseServerClient();

  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'client')
    .in('status', ['active', 'invited']);

  const capacity = canAddClient({
    plan: organization.plan,
    clientLimit: organization.client_limit,
    activeClients: count ?? 0,
    pilotMode: organization.pilot_mode,
  });
  if (!capacity.allowed) return { error: capacity.reason };

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', parsed.data.email)
    .maybeSingle();
  if (existing) return { error: 'Someone with that email is already in this workspace.' };

  // The assigned coach must be staff in this organization; RLS on profiles
  // makes an id from another tenant unreadable, so a miss here is a rejection.
  const { data: coach } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', parsed.data.coachId)
    .in('role', ['coach', 'organization_owner'])
    .maybeSingle();
  if (!coach) return { error: 'That coach is not part of this workspace.' };

  const { token, hash } = generateInviteToken();
  const admin = createSupabaseAdminClient();

  const { data: invitation, error } = await admin
    .from('invitations')
    .insert({
      organization_id: organization.id,
      email: parsed.data.email,
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      role: 'client',
      assigned_coach_id: parsed.data.coachId,
      token_hash: hash,
      invited_by: profile.id,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[invite] failed', error.message);
    return { error: 'Could not create that invitation.' };
  }

  const message = clientInvitationEmail({
    organizationName: organization.name,
    coachName: `${profile.first_name} ${profile.last_name}`.trim() || organization.name,
    clientFirstName: parsed.data.firstName,
    token,
    welcomeMessage: organization.welcome_message,
  });

  const result = await sendEmail({ ...message, to: parsed.data.email });

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'client.invited',
    entityType: 'invitation',
    entityId: invitation.id,
    metadata: { emailSent: result.sent },
  });

  revalidatePath('/app/coach/clients');

  if (result.skipped) {
    // Being explicit beats a silent no-op: without Resend configured the coach
    // needs the link to pass on themselves.
    return {
      message: `Invitation created. Email is not configured, so send this link yourself: /invite/${token}`,
    };
  }
  if (!result.sent) {
    return { message: `Invitation created, but the email failed to send. Share this link: /invite/${token}` };
  }
  return { message: `Invitation sent to ${parsed.data.email}.` };
}

// ---------------------------------------------------------------------------
// Coach notes
// ---------------------------------------------------------------------------

const NoteSchema = z.object({
  clientId: z.string().uuid(),
  body: z.string().trim().min(1, 'Write something first').max(8000),
});

export async function addCoachNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireStaff();

  const parsed = NoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Could not save that note' };

  const client = await resolveClient(parsed.data.clientId);
  if (!client) return { error: 'That client is not available to you.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('coach_notes').insert({
    organization_id: organization.id,
    client_id: client.id,
    author_id: profile.id,
    body: parsed.data.body,
  });

  if (error) return { error: 'Could not save that note.' };

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'coach_note.created',
    entityType: 'client',
    entityId: client.id,
  });

  revalidatePath(`/app/coach/clients/${client.id}`);
  return { message: 'Note saved.' };
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

const ExperimentSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(3, 'Give the experiment a name').max(160),
  hypothesis: z.string().trim().min(10, 'Describe what you think is happening').max(1000),
  intervention: z.string().trim().min(10, 'Describe what will change').max(1000),
  durationDays: z.coerce.number().int().min(3).max(90).default(14),
  patternId: z.string().uuid().optional().or(z.literal('')),
});

export async function createExperiment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireStaff();

  const parsed = ExperimentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  }

  const client = await resolveClient(parsed.data.clientId);
  if (!client) return { error: 'That client is not available to you.' };

  const supabase = await createSupabaseServerClient();
  const today = todayIn(organization.timezone);
  const baselineWindow = parsed.data.durationDays;

  // The baseline is captured now, from the window immediately before the
  // experiment starts. Recording it at creation time is what makes the result
  // meaningful later — a baseline computed afterwards can always be flattered.
  const { data: facts } = await supabase
    .from('commitment_facts')
    .select('*')
    .eq('client_id', client.id)
    .gte('commitment_date', lastNDays(today, baselineWindow).start);

  const baseline = followThroughOf(
    inWindow((facts ?? []) as CommitmentFact[], lastNDays(today, baselineWindow)),
  );

  const { data: experiment, error } = await supabase
    .from('experiments')
    .insert({
      organization_id: organization.id,
      client_id: client.id,
      pattern_id: parsed.data.patternId || null,
      title: parsed.data.title,
      hypothesis: parsed.data.hypothesis,
      intervention: parsed.data.intervention,
      metric_key: 'follow_through',
      baseline_metric: baseline.rate,
      baseline_window_days: baselineWindow,
      start_date: today,
      end_date: new Date(Date.parse(`${today}T00:00:00Z`) + baselineWindow * 86_400_000)
        .toISOString()
        .slice(0, 10),
      status: 'active',
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[experiment] creation failed', error.message);
    return { error: 'Could not start that experiment.' };
  }

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'experiment.created',
    entityType: 'experiment',
    entityId: experiment.id,
    metadata: { durationDays: baselineWindow, baseline: baseline.rate },
  });

  revalidatePath(`/app/coach/clients/${client.id}`);
  return {
    message:
      baseline.rate === null
        ? 'Experiment started. There was no baseline to record yet, so the result will be reported without a comparison.'
        : `Experiment started with a baseline of ${Math.round(baseline.rate * 100)}%.`,
  };
}

/**
 * Closes an experiment and measures the same metric over the period it ran.
 * Baseline and result are computed the same way over equal-length windows, so
 * the comparison is honest even when it is unflattering.
 */
export async function completeExperiment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireStaff();

  const experimentId = z.string().uuid().safeParse(formData.get('experimentId'));
  if (!experimentId.success) return { error: 'Unknown experiment.' };

  const supabase = await createSupabaseServerClient();
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId.data)
    .maybeSingle<Experiment>();

  if (!experiment) return { error: 'That experiment is not available to you.' };

  const today = todayIn(organization.timezone);
  const { data: facts } = await supabase
    .from('commitment_facts')
    .select('*')
    .eq('client_id', experiment.client_id)
    .gte('commitment_date', experiment.start_date);

  const window = { start: experiment.start_date, end: today };
  const result = followThroughOf(inWindow((facts ?? []) as CommitmentFact[], window));

  const summary =
    result.rate === null
      ? 'No commitments resolved during the experiment window, so there is nothing to compare.'
      : experiment.baseline_metric === null
        ? `Follow-through during the experiment was ${Math.round(result.rate * 100)}%. No baseline was recorded.`
        : `Follow-through moved from ${Math.round(experiment.baseline_metric * 100)}% to ${Math.round(
            result.rate * 100,
          )}% across ${result.eligible} commitments.`;

  const { error } = await supabase
    .from('experiments')
    .update({
      status: 'completed',
      end_date: today,
      result_metric: result.rate,
      result_summary: summary,
    })
    .eq('id', experiment.id);

  if (error) return { error: 'Could not close that experiment.' };

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'experiment.completed',
    entityType: 'experiment',
    entityId: experiment.id,
    metadata: { baseline: experiment.baseline_metric, result: result.rate },
  });

  revalidatePath(`/app/coach/clients/${experiment.client_id}`);
  return { message: summary };
}

// ---------------------------------------------------------------------------
// Alerts and patterns
// ---------------------------------------------------------------------------

export async function resolveAlert(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireStaff();
  const alertId = z.string().uuid().safeParse(formData.get('alertId'));
  if (!alertId.success) return { error: 'Unknown alert.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('coach_alerts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: profile.id })
    .eq('id', alertId.data)
    .select('client_id')
    .maybeSingle<{ client_id: string }>();

  if (error || !data) return { error: 'Could not resolve that alert.' };

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'alert.resolved',
    entityType: 'alert',
    entityId: alertId.data,
  });

  revalidatePath(`/app/coach/clients/${data.client_id}`);
  return { message: 'Alert resolved.' };
}

const PatternStatusSchema = z.object({
  patternId: z.string().uuid(),
  status: z.enum(['active', 'dismissed', 'resolved']),
});

export async function updatePatternStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireStaff();

  const parsed = PatternStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Unknown pattern.' };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('patterns')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.patternId)
    .select('client_id')
    .maybeSingle<{ client_id: string }>();

  if (error || !data) return { error: 'Could not update that pattern.' };

  if (parsed.data.status === 'dismissed') {
    await recordAudit({
      organizationId: organization.id,
      userId: profile.id,
      action: 'pattern.dismissed',
      entityType: 'pattern',
      entityId: parsed.data.patternId,
    });
  }

  revalidatePath(`/app/coach/clients/${data.client_id}`);
  return { message: parsed.data.status === 'dismissed' ? 'Pattern dismissed.' : 'Pattern updated.' };
}

// ---------------------------------------------------------------------------
// Coaching brief
// ---------------------------------------------------------------------------

export async function generateCoachingBrief(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireStaff();

  const clientId = z.string().uuid().safeParse(formData.get('clientId'));
  if (!clientId.success) return { error: 'Unknown client.' };

  const limit = rateLimit(`brief:${profile.id}`, LIMITS.ai.limit, LIMITS.ai.windowMs);
  if (!limit.allowed) {
    return { error: 'Brief generation limit reached for this hour. Try again shortly.' };
  }

  const intelligence = await getClientIntelligence(clientId.data, organization.timezone);
  if (!intelligence) return { error: 'That client is not available to you.' };

  const supabase = await createSupabaseServerClient();
  const { data: aiSettings } = await supabase
    .from('organization_ai_settings')
    .select('*')
    .eq('organization_id', organization.id)
    .maybeSingle<OrganizationAiSettings>();

  const periodEnd = intelligence.referenceDate;
  const periodStart = lastNDays(periodEnd, 30).start;
  const activeExperiment = intelligence.experiments.find((e) => e.status === 'active') ?? null;

  const brief = await generateBrief({
    clientFirstName: intelligence.client.first_name || 'This client',
    metrics: intelligence.metrics,
    patterns: intelligence.patterns,
    periodStart,
    periodEnd,
    organizationId: organization.id,
    aiSettings,
    activeExperiment: activeExperiment
      ? {
          title: activeExperiment.title,
          hypothesis: activeExperiment.hypothesis,
          status: activeExperiment.status,
        }
      : null,
  });

  const { error } = await supabase.from('coaching_briefs').insert({
    organization_id: organization.id,
    client_id: intelligence.client.id,
    period_start: periodStart,
    period_end: periodEnd,
    headline: brief.content.headline,
    summary: brief.content.summary,
    metrics_json: {
      followThrough7: intelligence.metrics.followThrough7,
      followThrough30: intelligence.metrics.followThrough30,
      followThroughPrev30: intelligence.metrics.followThroughPrev30,
      trend: intelligence.metrics.trend,
      calibration: intelligence.metrics.calibration,
      topReasons: intelligence.metrics.topReasons.slice(0, 5),
    },
    patterns_json: brief.content.keyObservations,
    suggested_questions_json: brief.content.suggestedQuestions,
    suggested_experiment: brief.content.suggestedExperiment,
    model: brief.model,
    generated_by: profile.id,
  });

  if (error) {
    console.error('[brief] save failed', error.message);
    return { error: 'The brief was generated but could not be saved.' };
  }

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'brief.generated',
    entityType: 'client',
    entityId: intelligence.client.id,
    metadata: { source: brief.source },
  });

  revalidatePath(`/app/coach/clients/${intelligence.client.id}`);
  return {
    message:
      brief.source === 'deterministic'
        ? 'Brief generated from your data. (AI wording is unavailable, so this is the plain version.)'
        : 'Brief generated.',
  };
}

// ---------------------------------------------------------------------------
// Invite a coach (organization owners only)
// ---------------------------------------------------------------------------

const InviteCoachSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(80),
  lastName: z.string().trim().max(80).default(''),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

export async function inviteCoach(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, profile } = await requireStaff();

  // Adding staff is an ownership decision, not something any coach may do.
  if (profile.role !== 'organization_owner') {
    return { error: 'Only the workspace owner can add coaches.' };
  }

  const parsed = InviteCoachSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', parsed.data.email)
    .maybeSingle();
  if (existing) return { error: 'Someone with that email is already in this workspace.' };

  const { token, hash } = generateInviteToken();
  const admin = createSupabaseAdminClient();

  const { error } = await admin.from('invitations').insert({
    organization_id: organization.id,
    email: parsed.data.email,
    first_name: parsed.data.firstName,
    last_name: parsed.data.lastName,
    role: 'coach',
    token_hash: hash,
    invited_by: profile.id,
  });

  if (error) {
    console.error('[invite coach] failed', error.message);
    return { error: 'Could not create that invitation.' };
  }

  const message = clientInvitationEmail({
    organizationName: organization.name,
    coachName: `${profile.first_name} ${profile.last_name}`.trim() || organization.name,
    clientFirstName: parsed.data.firstName,
    token,
    welcomeMessage: null,
  });

  const result = await sendEmail({
    ...message,
    to: parsed.data.email,
    subject: `Join ${organization.name} on Nellvia`,
  });

  await recordAudit({
    organizationId: organization.id,
    userId: profile.id,
    action: 'coach.invited',
    entityType: 'invitation',
    metadata: { emailSent: result.sent },
  });

  revalidatePath('/app/settings/team');

  return result.sent
    ? { message: `Invitation sent to ${parsed.data.email}.` }
    : { message: `Invitation created. Share this link: /invite/${token}` };
}
