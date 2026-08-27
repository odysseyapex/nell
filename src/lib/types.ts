/**
 * Domain types for Nell.
 *
 * These mirror the SQL schema in supabase/migrations. They are hand-written
 * rather than generated so that the pure logic in lib/metrics, lib/patterns
 * and lib/risk can be unit tested without a database connection.
 */

export type UserRole = 'super_admin' | 'organization_owner' | 'coach' | 'client';
export type OrgStatus = 'active' | 'paused' | 'cancelled';
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'pilot';
export type ProfileStatus = 'invited' | 'active' | 'paused' | 'archived';
export type FrameworkStatus = 'draft' | 'active' | 'archived';
export type ExerciseFrequency = 'daily' | 'weekly' | 'manual' | 'custom';
export type EntryStatus = 'started' | 'completed' | 'abandoned';
export type CommitmentStatus = 'planned' | 'completed' | 'changed' | 'missed' | 'cancelled';
export type PatternStatus = 'candidate' | 'active' | 'dismissed' | 'resolved';
export type AlertSeverity = 'low' | 'medium' | 'high';
export type ExperimentStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type RiskLevel = 'stable' | 'watch' | 'needs_attention';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export type StepInputType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'slider'
  | 'yes_no'
  | 'single_select'
  | 'multi_select'
  | 'scale';

/**
 * What actually happened. Kept deliberately richer than done/not-done: the
 * difference between an intentional change and an impulsive one is exactly
 * the kind of thing a coach needs to see.
 */
export type CheckinOutcome =
  | 'completed'
  | 'changed_intentionally'
  | 'changed_impulsively'
  | 'circumstances_changed'
  | 'missed';

export const CHECKIN_OUTCOMES: { value: CheckinOutcome; label: string; helper: string }[] = [
  { value: 'completed', label: 'I followed through', helper: 'It happened the way I planned.' },
  {
    value: 'changed_intentionally',
    label: 'I changed it intentionally',
    helper: 'I made a deliberate call to do something different.',
  },
  {
    value: 'changed_impulsively',
    label: 'I changed it impulsively',
    helper: 'It shifted in the moment without much thought.',
  },
  {
    value: 'circumstances_changed',
    label: 'Circumstances changed',
    helper: 'Something outside my control got in the way.',
  },
  { value: 'missed', label: "I didn't do it", helper: 'It did not happen.' },
];

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  welcome_message: string | null;
  timezone: string;
  status: OrgStatus;
  subscription_status: SubscriptionStatus;
  plan: string;
  client_limit: number;
  pilot_mode: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  auth_user_id: string | null;
  organization_id: string | null;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url: string | null;
  timezone: string | null;
  status: ProfileStatus;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Framework {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: FrameworkStatus;
  version: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface FrameworkStep {
  id: string;
  framework_id: string;
  organization_id: string;
  title: string;
  description: string | null;
  step_order: number;
  input_type: StepInputType;
  required: boolean;
  configuration_json: StepConfiguration;
  ai_analysis_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface StepConfiguration {
  placeholder?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  minLabel?: string;
  maxLabel?: string;
}

export interface Exercise {
  id: string;
  organization_id: string;
  framework_id: string;
  name: string;
  description: string | null;
  frequency: ExerciseFrequency;
  prompts_commitment: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExerciseAssignment {
  id: string;
  organization_id: string;
  exercise_id: string;
  client_id: string;
  assigned_by: string | null;
  start_date: string;
  end_date: string | null;
  schedule_json: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export interface ExerciseEntry {
  id: string;
  organization_id: string;
  client_id: string;
  exercise_id: string;
  entry_date: string;
  started_at: string;
  completed_at: string | null;
  status: EntryStatus;
  created_at: string;
}

export interface ExerciseResponse {
  id: string;
  organization_id: string;
  entry_id: string;
  framework_step_id: string;
  response_text: string | null;
  response_number: number | null;
  response_json: unknown;
  created_at: string;
}

export interface ReasonCode {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  category: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface Commitment {
  id: string;
  organization_id: string;
  client_id: string;
  source_entry_id: string | null;
  commitment_text: string;
  commitment_category: string | null;
  commitment_date: string;
  due_at: string | null;
  confidence_score: number | null;
  status: CommitmentStatus;
  created_hour_local: number | null;
  created_at: string;
  updated_at: string;
}

export interface CommitmentCheckin {
  id: string;
  organization_id: string;
  commitment_id: string;
  client_id: string;
  outcome: CheckinOutcome;
  reason_code_id: string | null;
  reason_text: string | null;
  emotion: string | null;
  context_json: Record<string, unknown>;
  checked_in_at: string;
  created_at: string;
}

/**
 * One row per commitment with its outcome attached — the shape returned by the
 * `commitment_facts` view and the input to every metric and pattern rule.
 */
export interface CommitmentFact {
  commitment_id: string;
  organization_id: string;
  client_id: string;
  commitment_text: string;
  commitment_category: string | null;
  commitment_date: string;
  due_at: string | null;
  confidence_score: number | null;
  status: CommitmentStatus;
  created_at: string;
  created_hour_local: number | null;
  weekday: number;
  is_weekend: boolean;
  outcome: CheckinOutcome | null;
  checked_in_at: string | null;
  emotion: string | null;
  reason_code_id: string | null;
  reason_slug: string | null;
  reason_name: string | null;
  reason_category: string | null;
}

export interface PatternEvidence {
  /** Short human-readable statements. Always derived from counted rows. */
  statements: string[];
  /** The raw numbers behind the statements, for auditability. */
  data: Record<string, number | string>;
  sampleSize: number;
}

export interface Pattern {
  id: string;
  organization_id: string;
  client_id: string;
  pattern_type: string;
  pattern_key: string;
  title: string;
  description: string;
  confidence_score: number;
  evidence_json: PatternEvidence;
  ai_explanation: string | null;
  suggested_question: string | null;
  suggested_experiment: string | null;
  first_detected_at: string;
  last_detected_at: string;
  status: PatternStatus;
  created_at: string;
  updated_at: string;
}

export interface CoachAlert {
  id: string;
  organization_id: string;
  client_id: string;
  alert_type: string;
  alert_key: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  recommended_action: string | null;
  evidence_json: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface Experiment {
  id: string;
  organization_id: string;
  client_id: string;
  pattern_id: string | null;
  title: string;
  hypothesis: string;
  intervention: string;
  metric_key: string;
  baseline_metric: number | null;
  baseline_window_days: number;
  start_date: string;
  end_date: string | null;
  status: ExperimentStatus;
  result_metric: number | null;
  result_summary: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoachingBrief {
  id: string;
  organization_id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  summary: string;
  headline: string | null;
  metrics_json: Record<string, unknown>;
  patterns_json: unknown[];
  suggested_questions_json: string[];
  suggested_experiment: string | null;
  model: string | null;
  generated_by: string | null;
  generated_at: string;
}

export interface CoachNote {
  id: string;
  organization_id: string;
  client_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationAiSettings {
  id: string;
  organization_id: string;
  coach_philosophy: string | null;
  preferred_language: string;
  preferred_tone: string;
  preferred_terminology_json: Record<string, string>;
  forbidden_topics_json: string[];
  system_guidelines: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientStatusSnapshot {
  id: string;
  organization_id: string;
  client_id: string;
  as_of: string;
  risk_level: RiskLevel;
  risk_reasons_json: string[];
  follow_through_7: number | null;
  follow_through_30: number | null;
  follow_through_90: number | null;
  follow_through_prev_30: number | null;
  trend: string | null;
  confidence_avg: number | null;
  calibration_gap: number | null;
  exercise_completion_30: number | null;
  open_commitments: number;
  overdue_checkins: number;
  days_since_activity: number | null;
  metrics_json: Record<string, unknown>;
  created_at: string;
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  assigned_coach_id: string | null;
  token_hash: string;
  status: InvitationStatus;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

/** Everything a server route needs to authorise a request. */
export interface SessionContext {
  authUserId: string;
  profile: Profile;
  organization: Organization | null;
}
