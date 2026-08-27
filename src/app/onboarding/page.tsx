import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FrameworkBuilder } from '@/components/settings/framework-builder';
import { InviteClientDialog } from '@/components/coach/invite-client-dialog';
import {
  BrandingStep,
  ExerciseStep,
  MethodStep,
  OrganizationStep,
  ReasonCodesStep,
} from '@/components/onboarding/steps';
import { ONBOARDING_STEPS, type OnboardingStep } from '@/lib/onboarding';
import { requireOwner } from '@/lib/auth/session';
import { brandStyle } from '@/lib/branding';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import type { Framework, FrameworkStep, OrganizationAiSettings, ReasonCode } from '@/lib/types';
import { displayName } from '@/lib/format';

export const metadata: Metadata = { title: 'Set up Nell' };
export const dynamic = 'force-dynamic';

const STEP_META: Record<OnboardingStep, { title: string; blurb: string }> = {
  organization: {
    title: 'Your business',
    blurb: 'The name your clients see, and the timezone Nell measures days in.',
  },
  branding: { title: 'Branding', blurb: 'Nell runs under your name, not ours.' },
  method: {
    title: 'Your coaching method',
    blurb: 'How Nell should sound when it writes for you. It never replaces your judgement.',
  },
  framework: {
    title: 'Your framework',
    blurb: 'The questions you already ask, turned into structure Nell can read.',
  },
  exercise: {
    title: 'Your first exercise',
    blurb: 'A framework in use — what your clients are actually asked to do.',
  },
  reasons: {
    title: 'Reasons',
    blurb: 'The vocabulary behind every pattern Nell will find.',
  },
  invite: { title: 'Your first client', blurb: 'One is enough to see how this works.' },
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { organization, profile } = await requireOwner();
  const { step: stepParam } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const [{ data: aiSettings }, { data: frameworks }, { data: reasonCodes }, { data: exercises }, { data: coaches }] =
    await Promise.all([
      supabase
        .from('organization_ai_settings')
        .select('*')
        .eq('organization_id', organization.id)
        .maybeSingle<OrganizationAiSettings>(),
      supabase.from('frameworks').select('*').order('created_at'),
      supabase.from('reason_codes').select('*').eq('active', true).order('sort_order'),
      supabase.from('exercises').select('id').eq('active', true),
      supabase.from('profiles').select('id, first_name, last_name, email').in('role', ['coach', 'organization_owner']),
    ]);

  const activeFramework = ((frameworks ?? []) as Framework[]).find((f) => f.status === 'active') ?? null;
  const hasExercise = (exercises ?? []).length > 0;

  // The furthest step the coach has actually earned, so a refresh does not
  // drop them back to the beginning.
  const derived: OnboardingStep = !activeFramework
    ? 'framework'
    : !hasExercise
      ? 'exercise'
      : 'invite';

  const step: OnboardingStep = ONBOARDING_STEPS.includes(stepParam as OnboardingStep)
    ? (stepParam as OnboardingStep)
    : derived === 'framework' && !aiSettings?.coach_philosophy
      ? 'organization'
      : derived;

  const stepIndex = ONBOARDING_STEPS.indexOf(step);

  const { data: frameworkSteps } = activeFramework
    ? await supabase
        .from('framework_steps')
        .select('*')
        .eq('framework_id', activeFramework.id)
        .order('step_order')
    : { data: [] };

  return (
    <div className="min-h-screen bg-muted/30" style={brandStyle(organization)}>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="font-semibold tracking-tight">Nell</span>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/app/coach">Skip for now</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <ol className="mb-8 flex flex-wrap gap-2">
          {ONBOARDING_STEPS.map((item, index) => (
            <li key={item}>
              <Link
                href={`/onboarding?step=${item}`}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  index === stepIndex
                    ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                    : index < stepIndex
                      ? 'border-transparent bg-muted text-muted-foreground'
                      : 'border-border text-muted-foreground',
                )}
              >
                {index < stepIndex ? <Check className="h-3 w-3" /> : null}
                {STEP_META[item].title}
              </Link>
            </li>
          ))}
        </ol>

        <div className="mb-6">
          <p className="metric-label">
            Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{STEP_META[step].title}</h1>
          <p className="mt-1 text-muted-foreground">{STEP_META[step].blurb}</p>
        </div>

        <Card>
          <CardContent className="p-6">
            {step === 'organization' ? (
              <OrganizationStep name={organization.name} timezone={organization.timezone} />
            ) : null}

            {step === 'branding' ? (
              <BrandingStep
                primaryColor={organization.primary_color}
                secondaryColor={organization.secondary_color}
                welcomeMessage={organization.welcome_message ?? ''}
                logoUrl={organization.logo_url ?? ''}
              />
            ) : null}

            {step === 'method' ? (
              <MethodStep
                coachPhilosophy={aiSettings?.coach_philosophy ?? ''}
                preferredTone={aiSettings?.preferred_tone ?? ''}
                systemGuidelines={aiSettings?.system_guidelines ?? ''}
                terminology={Object.entries(aiSettings?.preferred_terminology_json ?? {})
                  .map(([from, to]) => `${from}=${to}`)
                  .join(', ')}
                forbiddenTopics={(aiSettings?.forbidden_topics_json ?? []).join(', ')}
              />
            ) : null}

            {step === 'framework' ? (
              <div className="space-y-6">
                <FrameworkBuilder
                  frameworkId={activeFramework?.id}
                  initialName={activeFramework?.name}
                  initialDescription={activeFramework?.description ?? undefined}
                  initialSteps={(frameworkSteps ?? []) as FrameworkStep[]}
                />
                {activeFramework ? (
                  <Button asChild>
                    <Link href="/onboarding?step=exercise">Continue</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}

            {step === 'exercise' ? (
              hasExercise ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    You already have an active exercise. You can add more from settings at any time.
                  </p>
                  <Button asChild>
                    <Link href="/onboarding?step=reasons">Continue</Link>
                  </Button>
                </div>
              ) : (
                <ExerciseStep />
              )
            ) : null}

            {step === 'reasons' ? (
              <ReasonCodesStep reasonCodes={(reasonCodes ?? []) as ReasonCode[]} />
            ) : null}

            {step === 'invite' ? (
              <div className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  Your client gets a private link, chooses a password, and is assigned your active
                  exercises immediately. Nell needs roughly two weeks of their check-ins before
                  patterns become readable — until then it will say so rather than guess.
                </p>
                <div className="flex flex-wrap gap-3">
                  <InviteClientDialog
                    coaches={((coaches ?? []) as { id: string; first_name: string; last_name: string; email: string }[]).map(
                      (coach) => ({
                        id: coach.id,
                        name: displayName(coach),
                      }),
                    )}
                    defaultCoachId={profile.id}
                  />
                  <Button variant="outline" asChild>
                    <Link href="/app/coach">Go to my dashboard</Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
