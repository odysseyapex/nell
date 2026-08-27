-- ============================================================================
-- Nell 0002 — Frameworks, exercises, assignments, entries, responses
--
-- A framework is the coach's methodology, expressed as ordered steps. Nothing
-- about any particular coaching method is hard-coded: the steps and their
-- input types are data.
-- ============================================================================

do $$ begin
  create type framework_status as enum ('draft', 'active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type step_input_type as enum (
    'short_text', 'long_text', 'number', 'slider', 'yes_no',
    'single_select', 'multi_select', 'scale'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type exercise_frequency as enum ('daily', 'weekly', 'manual', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_status as enum ('started', 'completed', 'abandoned');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- frameworks
-- --------------------------------------------------------------------------
create table if not exists public.frameworks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  description     text,
  status          framework_status not null default 'draft',
  version         integer not null default 1,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists frameworks_org_status_idx on public.frameworks (organization_id, status);
create unique index if not exists frameworks_one_default_per_org
  on public.frameworks (organization_id) where is_default;

drop trigger if exists frameworks_set_updated_at on public.frameworks;
create trigger frameworks_set_updated_at before update on public.frameworks
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- framework_steps
-- --------------------------------------------------------------------------
create table if not exists public.framework_steps (
  id                  uuid primary key default gen_random_uuid(),
  framework_id        uuid not null references public.frameworks (id) on delete cascade,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  title               text not null,
  description         text,
  step_order          integer not null default 0,
  input_type          step_input_type not null default 'long_text',
  required            boolean not null default false,
  configuration_json  jsonb not null default '{}'::jsonb,
  ai_analysis_enabled boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists framework_steps_framework_order_idx
  on public.framework_steps (framework_id, step_order);

drop trigger if exists framework_steps_set_updated_at on public.framework_steps;
create trigger framework_steps_set_updated_at before update on public.framework_steps
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- exercises
-- --------------------------------------------------------------------------
create table if not exists public.exercises (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  framework_id        uuid not null references public.frameworks (id) on delete cascade,
  name                text not null,
  description         text,
  frequency           exercise_frequency not null default 'daily',
  -- When true, finishing this exercise flows straight into making a commitment.
  prompts_commitment  boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists exercises_org_active_idx on public.exercises (organization_id, active);

drop trigger if exists exercises_set_updated_at on public.exercises;
create trigger exercises_set_updated_at before update on public.exercises
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- exercise_assignments
-- --------------------------------------------------------------------------
create table if not exists public.exercise_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  exercise_id     uuid not null references public.exercises (id) on delete cascade,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  assigned_by     uuid references public.profiles (id) on delete set null,
  start_date      date not null default current_date,
  end_date        date,
  schedule_json   jsonb not null default '{}'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (exercise_id, client_id)
);

create index if not exists exercise_assignments_client_idx
  on public.exercise_assignments (client_id, active);
create index if not exists exercise_assignments_org_idx
  on public.exercise_assignments (organization_id);

-- --------------------------------------------------------------------------
-- exercise_entries — one attempt at an exercise
-- --------------------------------------------------------------------------
create table if not exists public.exercise_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  exercise_id     uuid not null references public.exercises (id) on delete cascade,
  entry_date      date not null default current_date,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  status          entry_status not null default 'started',
  created_at      timestamptz not null default now()
);

create index if not exists exercise_entries_client_date_idx
  on public.exercise_entries (client_id, entry_date desc);
create index if not exists exercise_entries_org_status_idx
  on public.exercise_entries (organization_id, status);

-- --------------------------------------------------------------------------
-- exercise_responses — structured answers, one row per step
-- --------------------------------------------------------------------------
create table if not exists public.exercise_responses (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  entry_id          uuid not null references public.exercise_entries (id) on delete cascade,
  framework_step_id uuid not null references public.framework_steps (id) on delete cascade,
  response_text     text,
  response_number   numeric,
  response_json     jsonb,
  created_at        timestamptz not null default now(),
  unique (entry_id, framework_step_id)
);

create index if not exists exercise_responses_entry_idx on public.exercise_responses (entry_id);
