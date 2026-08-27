-- ============================================================================
-- Nellvia 0008 — The client experience
--
-- The coach app answers "who needs me and why?". The client app answers a
-- different question: "what did I commit to, what happened, and what am I
-- learning about myself?" This migration adds the small amount of state that
-- second question needs, and nothing more — commitments, check-ins and
-- patterns are still the same tables the coach reads.
-- ============================================================================

do $$ begin
  create type client_insight_type as enum (
    'summary', 'timing', 'reason', 'calibration', 'weekday', 'size', 'strength'
  );
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- What the client expects to get in the way.
--
-- Captured at the moment of committing, alongside confidence, because a
-- foreseen obstacle that keeps recurring is a different coaching conversation
-- from one nobody saw coming.
-- --------------------------------------------------------------------------
alter table public.commitments
  add column if not exists anticipated_obstacle text;

-- --------------------------------------------------------------------------
-- client_preferences
-- --------------------------------------------------------------------------
create table if not exists public.client_preferences (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete cascade,
  client_id                 uuid not null unique references public.profiles (id) on delete cascade,
  notification_preferences  jsonb not null default
    '{"morning": true, "when_due": true, "evening_nudge": true, "weekly": true}'::jsonb,
  preferred_checkin_time    time not null default '19:00',
  timezone                  text,
  onboarding_complete       boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists client_preferences_org_idx on public.client_preferences (organization_id);

drop trigger if exists client_preferences_set_updated_at on public.client_preferences;
create trigger client_preferences_set_updated_at before update on public.client_preferences
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- client_insights
--
-- The client-facing wording of something the pattern engine found. Stored
-- rather than recomputed on every visit so that "Nellvia noticed…" stays stable
-- from one morning to the next, and so a client can dismiss one for good.
-- --------------------------------------------------------------------------
create table if not exists public.client_insights (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  insight_type    client_insight_type not null,
  insight_key     text not null,
  title           text not null,
  summary         text not null,
  suggestion      text,
  evidence_json   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  dismissed_at    timestamptz,
  unique (client_id, insight_key)
);

create index if not exists client_insights_client_idx
  on public.client_insights (client_id, created_at desc) where dismissed_at is null;

-- --------------------------------------------------------------------------
-- client_experiments
--
-- An experiment is designed by the coach but lived by the client, so their
-- side of it — whether they have accepted it, and what they made of it — is
-- kept separately from the coach's measurement.
-- --------------------------------------------------------------------------
create table if not exists public.client_experiments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  experiment_id   uuid not null references public.experiments (id) on delete cascade,
  status          text not null default 'active',
  reflection      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (client_id, experiment_id)
);

create index if not exists client_experiments_client_idx on public.client_experiments (client_id, status);

drop trigger if exists client_experiments_set_updated_at on public.client_experiments;
create trigger client_experiments_set_updated_at before update on public.client_experiments
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------------
alter table public.client_preferences  enable row level security;
alter table public.client_insights     enable row level security;
alter table public.client_experiments  enable row level security;

-- Preferences belong to the client. Staff may read them (to know when a
-- client prefers to check in) but not rewrite someone's own settings.
drop policy if exists client_preferences_select on public.client_preferences;
create policy client_preferences_select on public.client_preferences for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists client_preferences_write_self on public.client_preferences;
create policy client_preferences_write_self on public.client_preferences for all to authenticated
  using (client_id = public.current_profile_id())
  with check (client_id = public.current_profile_id());

-- Insights are written for the client, so the client reads them; staff can
-- see what their client is being told.
drop policy if exists client_insights_select on public.client_insights;
create policy client_insights_select on public.client_insights for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists client_insights_dismiss_self on public.client_insights;
create policy client_insights_dismiss_self on public.client_insights for update to authenticated
  using (client_id = public.current_profile_id())
  with check (client_id = public.current_profile_id());

drop policy if exists client_insights_write_staff on public.client_insights;
create policy client_insights_write_staff on public.client_insights for all to authenticated
  using (public.can_manage_client(client_id))
  with check (public.can_manage_client(client_id));

drop policy if exists client_experiments_select on public.client_experiments;
create policy client_experiments_select on public.client_experiments for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists client_experiments_write_self on public.client_experiments;
create policy client_experiments_write_self on public.client_experiments for all to authenticated
  using (client_id = public.current_profile_id())
  with check (client_id = public.current_profile_id());

drop policy if exists client_experiments_write_staff on public.client_experiments;
create policy client_experiments_write_staff on public.client_experiments for all to authenticated
  using (public.can_manage_client(client_id))
  with check (public.can_manage_client(client_id));

-- --------------------------------------------------------------------------
-- Default reason vocabulary, revised for one-tap check-in.
--
-- Ten reasons, not thirteen: every extra chip is another decision at the exact
-- moment we are asking someone to be honest about a day that did not go well.
-- "Did not want to" is replaced by "Changed my mind", which describes the same
-- event without the verdict attached.
-- --------------------------------------------------------------------------
create or replace function public.seed_default_reason_codes(org uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.reason_codes (organization_id, name, slug, category, sort_order)
  values
    (org, 'Stress',            'stress',            'emotional',    10),
    (org, 'Low energy',        'low-energy',        'physical',     20),
    (org, 'Not enough time',   'time',              'situational',  30),
    (org, 'Hunger',            'hunger',            'physical',     40),
    (org, 'Social situation',  'social-situation',  'situational',  50),
    (org, 'Schedule changed',  'schedule-change',   'situational',  60),
    (org, 'Forgot',            'forgot',            'cognitive',    70),
    (org, 'Did not prepare',   'didnt-prepare',     'cognitive',    80),
    (org, 'Changed my mind',   'changed-my-mind',   'motivational', 90),
    (org, 'Other',             'other',             'other',       100)
  on conflict (organization_id, slug) do nothing;
end;
$fn$;
