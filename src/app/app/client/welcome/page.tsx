import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { WelcomeFlow } from '@/components/client/welcome-flow';
import { requireClient } from '@/lib/auth/session';
import { ensureClientPreferences } from '@/lib/data/client-view';
import { displayName } from '@/lib/format';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Exercise, Profile } from '@/lib/types';

export const metadata: Metadata = { title: 'Welcome' };
export const dynamic = 'force-dynamic';

export default async function ClientWelcomePage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;

  const preferences = await ensureClientPreferences(profile.id, organization.id, timezone);
  if (preferences?.onboarding_complete) redirect('/app/client');

  const supabase = await createSupabaseServerClient();
  const [{ data: assignment }, { data: exercises }] = await Promise.all([
    supabase
      .from('coach_client_assignments')
      .select('coach:profiles!coach_client_assignments_coach_id_fkey(first_name, last_name, email)')
      .eq('client_id', profile.id)
      .maybeSingle(),
    supabase.from('exercises').select('*').eq('active', true).limit(1),
  ]);

  const coach = (assignment as { coach?: Profile } | null)?.coach ?? null;
  const exercise = ((exercises ?? []) as Exercise[])[0] ?? null;

  return (
    <WelcomeFlow
      firstName={profile.first_name}
      coachName={coach ? displayName(coach) : null}
      organizationName={organization.name}
      welcomeMessage={organization.welcome_message}
      exerciseName={exercise?.name ?? null}
    />
  );
}
