-- ============================================================================
-- Nell 0004 — Intelligence layer
--
-- Patterns, alerts, risk snapshots, coaching briefs, experiments, coach notes.
-- Everything here stores *evidence* alongside the conclusion: no number ever
-- appears in the coach UI without the rows that produced it.
-- ============================================================================

do $$ begin
  create type pattern_status as enum ('candidate', 'active', 'dismissed', 'resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_severity as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type experiment_status as enum ('draft', 'active', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type risk_level as enum ('stable', 'watch', 'needs_attention');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- patterns — produced by the deterministic rule engine, explained by AI
-- --------------------------------------------------------------------------
create table if not exists public.patterns (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  client_id         uuid not null references public.profiles (id) on delete cascade,
  pattern_type      text not null,
  -- Stable identity for a recurring finding so re-running detection updates
  -- the existing row instead of piling up duplicates.
  pattern_key       text not null,
  title             text not null,
  description       text not null,
  confidence_score  numeric(4,3) not null default 0.5 check (confidence_score between 0 and 1),
  evidence_json     jsonb not null default '{}'::jsonb,
  ai_explanation    text,
  suggested_question text,
  suggested_experiment text,
  first_detected_at timestamptz not null default now(),
  last_detected_at  timestamptz not null default now(),
  status            pattern_status not null default 'candidate',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (client_id, pattern_key)
);

create index if not exists patterns_client_status_idx on public.patterns (client_id, status);
create index if not exists patterns_org_idx on public.patterns (organization_id, last_detected_at desc);

drop trigger if exists patterns_set_updated_at on public.patterns;
create trigger patterns_set_updated_at before update on public.patterns
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- coach_alerts
-- --------------------------------------------------------------------------
create table if not exists public.coach_alerts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  client_id          uuid not null references public.profiles (id) on delete cascade,
  alert_type         text not null,
  alert_key          text not null,
  severity           alert_severity not null default 'medium',
  title              text not null,
  description        text not null,
  recommended_action text,
  evidence_json      jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        uuid references public.profiles (id) on delete set null
);

create unique index if not exists coach_alerts_open_key_uniq
  on public.coach_alerts (client_id, alert_key) where resolved_at is null;
create index if not exists coach_alerts_org_open_idx
  on public.coach_alerts (organization_id, severity) where resolved_at is null;

-- --------------------------------------------------------------------------
-- client_status_snapshots — nightly rollup powering the coach dashboard.
-- Storing the rollup keeps the "Needs Attention" list a single indexed read
-- instead of recomputing every client's history on every page load.
-- --------------------------------------------------------------------------
create table if not exists public.client_status_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  client_id               uuid not null references public.profiles (id) on delete cascade,
  as_of                   date not null default current_date,
  risk_level              risk_level not null default 'stable',
  risk_reasons_json       jsonb not null default '[]'::jsonb,
  follow_through_7        numeric(5,4),
  follow_through_30       numeric(5,4),
  follow_through_90       numeric(5,4),
  follow_through_prev_30  numeric(5,4),
  trend                   text,
  confidence_avg          numeric(5,2),
  calibration_gap         numeric(5,4),
  exercise_completion_30  numeric(5,4),
  open_commitments        integer not null default 0,
  overdue_checkins        integer not null default 0,
  days_since_activity     integer,
  metrics_json            jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  unique (client_id, as_of)
);

create index if not exists snapshots_org_risk_idx
  on public.client_status_snapshots (organization_id, as_of desc, risk_level);

-- --------------------------------------------------------------------------
-- coaching_briefs
-- --------------------------------------------------------------------------
create table if not exists public.coaching_briefs (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  client_id                uuid not null references public.profiles (id) on delete cascade,
  period_start             date not null,
  period_end               date not null,
  summary                  text not null,
  headline                 text,
  metrics_json             jsonb not null default '{}'::jsonb,
  patterns_json            jsonb not null default '[]'::jsonb,
  suggested_questions_json jsonb not null default '[]'::jsonb,
  suggested_experiment     text,
  model                    text,
  generated_by             uuid references public.profiles (id) on delete set null,
  generated_at             timestamptz not null default now()
);

create index if not exists briefs_client_idx on public.coaching_briefs (client_id, generated_at desc);

-- --------------------------------------------------------------------------
-- experiments — the intervention loop: hypothesis, change, measured result
-- --------------------------------------------------------------------------
create table if not exists public.experiments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  client_id        uuid not null references public.profiles (id) on delete cascade,
  pattern_id       uuid references public.patterns (id) on delete set null,
  title            text not null,
  hypothesis       text not null,
  intervention     text not null,
  metric_key       text not null default 'follow_through',
  baseline_metric  numeric(5,4),
  baseline_window_days integer not null default 14,
  start_date       date not null default current_date,
  end_date         date,
  status           experiment_status not null default 'draft',
  result_metric    numeric(5,4),
  result_summary   text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists experiments_client_status_idx on public.experiments (client_id, status);
create index if not exists experiments_org_status_idx on public.experiments (organization_id, status);

drop trigger if exists experiments_set_updated_at on public.experiments;
create trigger experiments_set_updated_at before update on public.experiments
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- coach_notes — private to staff; never shown to the client
-- --------------------------------------------------------------------------
create table if not exists public.coach_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  author_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists coach_notes_client_idx on public.coach_notes (client_id, created_at desc);

drop trigger if exists coach_notes_set_updated_at on public.coach_notes;
create trigger coach_notes_set_updated_at before update on public.coach_notes
  for each row execute function public.set_updated_at();
