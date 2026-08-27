'use server';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { getSessionContext, homePathFor } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/tokens';
import { LIMITS, rateLimit } from '@/lib/auth/rate-limit';
import { coachWelcomeEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Invitation, Organization, Profile } from '@/lib/types';

/**
 * Authentication server actions.
 *
 * The service-role client appears here because these are the moments where
 * there is no session yet — creating the very first profile, or reading an
 * invitation by token. Every use is bounded to a single row and none of them
 * accept an organization id from the caller.
 */

export interface ActionState {
  error?: string;
  message?: string;
}

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');
const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long');

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

const SignInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
  next: z.string().optional(),
});

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = SignInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  }

  const limit = rateLimit(`signin:${parsed.data.email}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return { error: 'Too many attempts. Wait a few minutes and try again.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // Deliberately vague: distinguishing "no such account" from "wrong password"
  // turns the login form into an account-enumeration oracle.
  if (error) return { error: 'That email and password do not match an account.' };

  const session = await getSessionContext();
  redirect(parsed.data.next || (session ? homePathFor(session.profile.role) : '/app'));
}

// ---------------------------------------------------------------------------
// Coach signup — creates the auth user, the organization and the owner profile
// ---------------------------------------------------------------------------

const SignUpSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().max(80).default(''),
  organizationName: z.string().trim().min(2, 'Enter your business name').max(120),
  email: emailSchema,
  password: passwordSchema,
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'coach'
  );
}

async function uniqueSlug(base: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  let candidate = base;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data } = await supabase.from('organizations').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${randomBytes(2).toString('hex')}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function signUpCoach(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = SignUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  }

  const { firstName, lastName, organizationName, email, password } = parsed.data;

  const limit = rateLimit(`signup:${email}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) return { error: 'Too many signup attempts. Try again later.' };

  const supabase = await createSupabaseServerClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { first_name: firstName, last_name: lastName } },
  });

  if (signUpError || !signUpData.user) {
    return { error: signUpError?.message ?? 'Could not create that account.' };
  }

  const admin = createSupabaseAdminClient();

  const { data: organization, error: orgError } = await admin
    .from('organizations')
    .insert({
      name: organizationName,
      slug: await uniqueSlug(slugify(organizationName)),
      subscription_status: 'trialing',
      plan: 'starter',
      client_limit: 10,
      trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    })
    .select()
    .single<Organization>();

  if (orgError || !organization) {
    console.error('[signup] organization creation failed', orgError?.message);
    return { error: 'Your account was created but the workspace was not. Please contact support.' };
  }

  const { error: profileError } = await admin.from('profiles').insert({
    auth_user_id: signUpData.user.id,
    organization_id: organization.id,
    role: 'organization_owner',
    first_name: firstName,
    last_name: lastName,
    email,
    status: 'active',
    last_active_at: new Date().toISOString(),
  });

  if (profileError) {
    console.error('[signup] profile creation failed', profileError.message);
    return { error: 'Your workspace was created but your profile was not. Please contact support.' };
  }

  // Seeds default reason codes and the AI settings row.
  await admin.rpc('bootstrap_organization', { org: organization.id });

  await recordAudit({
    organizationId: organization.id,
    userId: null,
    action: 'organization.created',
    entityType: 'organization',
    entityId: organization.id,
    metadata: { name: organizationName },
  });

  const welcome = coachWelcomeEmail({ organizationName, firstName });
  await sendEmail({ ...welcome, to: email });

  redirect('/onboarding');
}

// ---------------------------------------------------------------------------
// Invitation acceptance
// ---------------------------------------------------------------------------

export interface InvitationPreview {
  organizationName: string;
  firstName: string;
  email: string;
  role: string;
  welcomeMessage: string | null;
}

/**
 * Reads an invitation by raw token.
 *
 * Only the hash is stored, so a leaked database gives an attacker nothing they
 * can redeem. Expiry and status are checked here rather than trusted from the
 * link.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  let admin: ReturnType<typeof createSupabaseAdminClient>;

  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    // An invitation we cannot verify is an invitation we must not honour. The
    // visitor sees the same "no longer valid" screen as a genuinely expired
    // link; the real cause is logged for whoever deployed this.
    console.error('[invite] cannot verify invitations:', error instanceof Error ? error.message : error);
    return null;
  }

  const { data: invitation } = await admin
    .from('invitations')
    .select('*')
    .eq('token_hash', hashToken(token))
    .eq('status', 'pending')
    .maybeSingle<Invitation>();

  if (!invitation) return null;
  if (new Date(invitation.expires_at) < new Date()) return null;

  const { data: organization } = await admin
    .from('organizations')
    .select('name, welcome_message')
    .eq('id', invitation.organization_id)
    .maybeSingle<Pick<Organization, 'name' | 'welcome_message'>>();

  return {
    organizationName: organization?.name ?? 'your coach',
    firstName: invitation.first_name,
    email: invitation.email,
    role: invitation.role,
    welcomeMessage: organization?.welcome_message ?? null,
  };
}

const AcceptSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export async function acceptInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = AcceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  }

  const admin = createSupabaseAdminClient();
  const tokenHash = hashToken(parsed.data.token);

  const { data: invitation } = await admin
    .from('invitations')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('status', 'pending')
    .maybeSingle<Invitation>();

  if (!invitation) return { error: 'This invitation is no longer valid.' };
  if (new Date(invitation.expires_at) < new Date()) {
    await admin.from('invitations').update({ status: 'expired' }).eq('id', invitation.id);
    return { error: 'This invitation has expired. Ask your coach to send a new one.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: invitation.email,
    password: parsed.data.password,
    options: { data: { first_name: invitation.first_name, last_name: invitation.last_name } },
  });

  if (signUpError || !signUpData.user) {
    return { error: signUpError?.message ?? 'Could not create that account.' };
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({
      auth_user_id: signUpData.user.id,
      organization_id: invitation.organization_id,
      role: invitation.role,
      first_name: invitation.first_name,
      last_name: invitation.last_name,
      email: invitation.email,
      status: 'active',
      last_active_at: new Date().toISOString(),
    })
    .select()
    .single<Profile>();

  if (profileError || !profile) {
    console.error('[invite] profile creation failed', profileError?.message);
    return { error: 'Your account was created but could not be linked. Please contact your coach.' };
  }

  if (invitation.role === 'client' && invitation.assigned_coach_id) {
    await admin.from('coach_client_assignments').insert({
      organization_id: invitation.organization_id,
      coach_id: invitation.assigned_coach_id,
      client_id: profile.id,
    });

    // Give the new client every active exercise so their first day is not empty.
    const { data: exercises } = await admin
      .from('exercises')
      .select('id')
      .eq('organization_id', invitation.organization_id)
      .eq('active', true);

    if (exercises && exercises.length > 0) {
      await admin.from('exercise_assignments').insert(
        exercises.map((exercise: { id: string }) => ({
          organization_id: invitation.organization_id,
          exercise_id: exercise.id,
          client_id: profile.id,
          assigned_by: invitation.assigned_coach_id,
        })),
      );
    }
  }

  await admin
    .from('invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  await recordAudit({
    organizationId: invitation.organization_id,
    userId: profile.id,
    action: 'invitation.accepted',
    entityType: 'invitation',
    entityId: invitation.id,
    metadata: { role: invitation.role },
  });

  redirect(homePathFor(invitation.role));
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
