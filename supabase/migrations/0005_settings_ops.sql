-- ============================================================================
-- Nell 0005 — Organization AI settings, invitations, audit log, AI usage
-- ============================================================================

do $$ begin
  create type invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- organization_ai_settings — how Nell is allowed to talk about this org's
-- clients. Injected into every model call for the organization.
-- --------------------------------------------------------------------------
create table if not exists public.organization_ai_settings (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null unique references public.organizations (id) on delete cascade,
  coach_philosophy           text,
  preferred_language         text not null default 'en',
  preferred_tone             text not null default 'calm, curious, non-judgemental',
  preferred_terminology_json jsonb not null default '{}'::jsonb,
  forbidden_topics_json      jsonb not null default '[]'::jsonb,
  system_guidelines          text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

drop trigger if exists org_ai_settings_set_updated_at on public.organization_ai_settings;
create trigger org_ai_settings_set_updated_at before update on public.organization_ai_settings
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- invitations — coaches and clients join through a single-use hashed token
-- --------------------------------------------------------------------------
create table if not exists public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null,
  first_name       text not null default '',
  last_name        text not null default '',
  role             user_role not null default 'client',
  assigned_coach_id uuid references public.profiles (id) on delete set null,
  -- Only the SHA-256 of the token is stored; the raw token exists solely in
  -- the invitation email.
  token_hash       text not null unique,
  status           invitation_status not null default 'pending',
  invited_by       uuid references public.profiles (id) on delete set null,
  expires_at       timestamptz not null default (now() + interval '14 days'),
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists invitations_org_status_idx on public.invitations (organization_id, status);
create index if not exists invitations_email_idx on public.invitations (lower(email));

-- --------------------------------------------------------------------------
-- audit_logs
-- --------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete set null,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  metadata_json   jsonb not null default '{}'::jsonb,
  ip_address      text,
  created_at      timestamptz not null default now()
);

create index if not exists audit_logs_org_time_idx on public.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- --------------------------------------------------------------------------
-- ai_usage_events — cost and reliability visibility for the platform admin.
-- Deliberately records token counts and outcome only, never prompt content.
-- --------------------------------------------------------------------------
create table if not exists public.ai_usage_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  feature         text not null,
  model           text not null,
  prompt_tokens   integer not null default 0,
  completion_tokens integer not null default 0,
  latency_ms      integer,
  succeeded       boolean not null default true,
  error_code      text,
  created_at      timestamptz not null default now()
);

create index if not exists ai_usage_org_time_idx on public.ai_usage_events (organization_id, created_at desc);

-- --------------------------------------------------------------------------
-- Bootstrapping a new organization: default reason codes + AI settings row.
-- --------------------------------------------------------------------------
create or replace function public.bootstrap_organization(org uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  perform public.seed_default_reason_codes(org);
  insert into public.organization_ai_settings (organization_id)
  values (org)
  on conflict (organization_id) do nothing;
end;
$fn$;
