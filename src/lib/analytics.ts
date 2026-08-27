/**
 * Product analytics event vocabulary.
 *
 * One rule governs everything here: no client reflection text, commitment
 * text, reason text or coach note ever leaves the database for an analytics
 * tool. Events carry identifiers, counts and enums only. If a property could
 * contain something a client wrote, it does not belong in this file.
 */

export const ANALYTICS_EVENTS = {
  coachSignup: 'coach_signup',
  organizationCreated: 'organization_created',
  onboardingStepCompleted: 'onboarding_step_completed',
  frameworkPublished: 'framework_published',
  clientInvited: 'client_invited',
  clientActivated: 'client_activated',
  exerciseStarted: 'exercise_started',
  exerciseCompleted: 'exercise_completed',
  commitmentCreated: 'commitment_created',
  commitmentCheckedIn: 'commitment_checked_in',
  insightViewed: 'insight_viewed',
  patternDetected: 'pattern_detected',
  experimentCreated: 'experiment_created',
  experimentCompleted: 'experiment_completed',
  coachBriefGenerated: 'coach_brief_generated',
  alertOpened: 'alert_opened',
  checkoutStarted: 'checkout_started',
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Properties permitted on analytics events. Note the absence of free text. */
export interface AnalyticsProperties {
  organization_id?: string;
  role?: string;
  plan?: string;
  step?: string;
  outcome?: string;
  confidence_bucket?: string;
  pattern_type?: string;
  severity?: string;
  count?: number;
  source?: string;
}

/** Confidence is reported as a bucket so an individual prediction is never itself the datapoint. */
export function confidenceBucket(score: number): string {
  if (score >= 90) return '90-100';
  if (score >= 75) return '75-89';
  if (score >= 50) return '50-74';
  if (score >= 25) return '25-49';
  return '0-24';
}
