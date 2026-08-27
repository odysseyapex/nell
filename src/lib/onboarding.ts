/**
 * Onboarding step order.
 *
 * Lives outside the server-actions module because a 'use server' file may only
 * export async functions — a plain constant there fails the build.
 *
 * The order is intentional: a coach describes their own method before Nellvia
 * asks them to invite anyone. A framework built after the first client has
 * already started is a framework that gets abandoned.
 */
export const ONBOARDING_STEPS = [
  'organization',
  'branding',
  'method',
  'framework',
  'exercise',
  'reasons',
  'invite',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function nextOnboardingPath(current: OnboardingStep): string {
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(current) + 1];
  return next ? `/onboarding?step=${next}` : '/app/coach';
}
