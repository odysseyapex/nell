-- ============================================================================
-- Nell 0003 — Commitments, reason codes, check-ins
--
-- This is the heart of the product. A commitment is recorded BEFORE the
-- behaviour, together with the client's own predicted confidence. A check-in
-- is recorded AFTER, with a structured outcome and reason. Nell never
-- collapses the two into a single "done / not done" flag — the gap between
-- intention and outcome is the signal.
-- ============================================================================

do $$ begin
  create type commitment_status as enum ('planned', 'completed', 'changed', 'missed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type checkin_outcome as enum (
    'completed',
    'changed_intentionally',
    'changed_impulsively',
    'circumstances_changed',
    'missed'
  );
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- reason_codes — org-customisable vocabulary for "what influenced that?"
-- --------------------------------------------------------------------------
create table if not exists public.reason_codes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  slug            text not null,
  category        text not null default 'other',
  sort_order      integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, slug)
);

create index if not exists reason_codes_org_active_idx on public.reason_codes (organization_id, active);

-- Seeds the default reason vocabulary for a new organization. Coaches can then
-- rename, deactivate or add to it.
create or replace function public.seed_default_reason_codes(org uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.reason_codes (organization_id, name, slug, category, sort_order)
  values
    (org, 'Stress',              'stress',             'emotional',    10),
    (org, 'Hunger',              'hunger',             'physical',     20),
    (org, 'Craving',             'craving',            'physical',     30),
    (org, 'Not enough time',     'time',               'situational',  40),
    (org, 'Social situation',    'social-situation',   'situational',  50),
    (org, 'Schedule changed',    'schedule-change',    'situational',  60),
    (org, 'Forgot',              'forgot',             'cognitive',    70),
    (org, 'Did not prepare',     'didnt-prepare',      'cognitive',    80),
    (org, 'Did not want to',     'didnt-want-to',      'motivational', 90),
    (org, 'Low energy',          'low-energy',         'physical',    100),
    (org, 'Emotion',             'emotion',            'emotional',   110),
    (org, 'Convenience',         'convenience',        'situational', 120),
    (org, 'Other',               'other',              'other',       130)
  on conflict (organization_id, slug) do nothing;
end;
$fn$;

-- --------------------------------------------------------------------------
-- commitments
-- --------------------------------------------------------------------------
create table if not exists public.commitments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  client_id           uuid not null references public.profiles (id) on delete cascade,
  source_entry_id     uuid references public.exercise_entries (id) on delete set null,
  commitment_text     text not null,
  commitment_category text,
  -- The day the behaviour is meant to happen.
  commitment_date     date not null default current_date,
  due_at              timestamptz,
  -- The client's own prediction, 0-100, captured at the moment of committing.
  confidence_score    integer check (confidence_score between 0 and 100),
  status              commitment_status not null default 'planned',
  -- Denormalised from the created_at timestamp in the client's timezone so
  -- that "commitments made after 9pm" style rules stay cheap to evaluate.
  created_hour_local  smallint,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists commitments_client_date_idx
  on public.commitments (client_id, commitment_date desc);
create index if not exists commitments_client_status_idx
  on public.commitments (client_id, status);
create index if not exists commitments_org_date_idx
  on public.commitments (organization_id, commitment_date desc);
create index if not exists commitments_open_idx
  on public.commitments (client_id, due_at) where status = 'planned';

drop trigger if exists commitments_set_updated_at on public.commitments;
create trigger commitments_set_updated_at before update on public.commitments
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- commitment_checkins — what actually happened, and why
-- --------------------------------------------------------------------------
create table if not exists public.commitment_checkins (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  commitment_id   uuid not null references public.commitments (id) on delete cascade,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  outcome         checkin_outcome not null,
  reason_code_id  uuid references public.reason_codes (id) on delete set null,
  reason_text     text,
  emotion         text,
  context_json    jsonb not null default '{}'::jsonb,
  checked_in_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (commitment_id)
);

create index if not exists checkins_client_time_idx
  on public.commitment_checkins (client_id, checked_in_at desc);
create index if not exists checkins_reason_idx
  on public.commitment_checkins (organization_id, reason_code_id);

-- --------------------------------------------------------------------------
-- Keep commitment.status consistent with its check-in. Doing this in the
-- database rather than the application means the follow-through numbers can
-- never drift from the recorded outcomes.
-- --------------------------------------------------------------------------
create or replace function public.sync_commitment_status()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.commitments
     set status = case new.outcome
                    when 'completed' then 'completed'::commitment_status
                    when 'missed'    then 'missed'::commitment_status
                    else 'changed'::commitment_status
                  end
   where id = new.commitment_id;
  return new;
end;
$fn$;

drop trigger if exists checkins_sync_commitment_status on public.commitment_checkins;
create trigger checkins_sync_commitment_status
  after insert or update of outcome on public.commitment_checkins
  for each row execute function public.sync_commitment_status();
