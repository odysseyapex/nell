-- ============================================================================
-- Nellvia 0001 — Core tenancy: organizations, profiles, assignments, auth helpers
-- ============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- Enums
-- --------------------------------------------------------------------------
do $$ begin
  create type org_status as enum ('active', 'paused', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'pilot');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('super_admin', 'organization_owner', 'coach', 'client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type profile_status as enum ('invited', 'active', 'paused', 'archived');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- updated_at trigger helper
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- --------------------------------------------------------------------------
-- organizations
-- --------------------------------------------------------------------------
create table if not exists public.organizations (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null unique,
  logo_url               text,
  primary_color          text not null default '#1F2937',
  secondary_color        text not null default '#0EA5A4',
  welcome_message        text,
  timezone               text not null default 'America/New_York',
  status                 org_status not null default 'active',
  subscription_status    subscription_status not null default 'trialing',
  plan                   text not null default 'starter',
  client_limit           integer not null default 10,
  pilot_mode             boolean not null default false,
  stripe_customer_id     text,
  stripe_subscription_id text,
  trial_ends_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')
);

create index if not exists organizations_status_idx on public.organizations (status);
create index if not exists organizations_stripe_customer_idx on public.organizations (stripe_customer_id);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- profiles — one row per human. organization_id is null only for super_admin.
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  role            user_role not null,
  first_name      text not null default '',
  last_name       text not null default '',
  email           text not null,
  avatar_url      text,
  timezone        text,
  status          profile_status not null default 'active',
  last_active_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint profiles_org_required check (role = 'super_admin' or organization_id is not null)
);

create index if not exists profiles_org_role_idx on public.profiles (organization_id, role);
create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_last_active_idx on public.profiles (organization_id, last_active_at desc);
create unique index if not exists profiles_org_email_uniq
  on public.profiles (organization_id, lower(email))
  where organization_id is not null;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- coach_client_assignments — which coach is responsible for which client
-- --------------------------------------------------------------------------
create table if not exists public.coach_client_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  coach_id        uuid not null references public.profiles (id) on delete cascade,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  is_primary      boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (coach_id, client_id)
);

create index if not exists cca_org_coach_idx on public.coach_client_assignments (organization_id, coach_id);
create index if not exists cca_client_idx on public.coach_client_assignments (client_id);

-- --------------------------------------------------------------------------
-- Authorization helpers.
--
-- These are SECURITY DEFINER so that RLS policies can consult `profiles`
-- without recursing into the policies defined on `profiles` itself.
-- Every one of them derives the caller's organization from auth.uid() — the
-- application never gets to assert its own organization_id.
-- --------------------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid language sql stable security definer set search_path = public as $fn$
  select id from public.profiles where auth_user_id = auth.uid() limit 1;
$fn$;

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $fn$
  select organization_id from public.profiles where auth_user_id = auth.uid() limit 1;
$fn$;

create or replace function public.current_user_role()
returns user_role language sql stable security definer set search_path = public as $fn$
  select role from public.profiles where auth_user_id = auth.uid() limit 1;
$fn$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select role = 'super_admin' from public.profiles where auth_user_id = auth.uid() limit 1),
    false);
$fn$;

create or replace function public.is_org_staff(org uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select p.organization_id = org and p.role in ('organization_owner', 'coach')
    from public.profiles p where p.auth_user_id = auth.uid() limit 1
  ), false);
$fn$;

create or replace function public.is_org_owner(org uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select p.organization_id = org and p.role = 'organization_owner'
    from public.profiles p where p.auth_user_id = auth.uid() limit 1
  ), false);
$fn$;

-- Read gate for every client-scoped row: the caller may read a client's data
-- when they ARE that client, when they own the organization, or when they are
-- a coach explicitly assigned to that client.
create or replace function public.can_access_client(client uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  with me as (
    select id, organization_id, role from public.profiles where auth_user_id = auth.uid() limit 1
  )
  select coalesce((
    select case
      when me.id = client then true
      when me.role = 'organization_owner' then exists (
        select 1 from public.profiles c
        where c.id = client and c.organization_id = me.organization_id)
      when me.role = 'coach' then exists (
        select 1 from public.coach_client_assignments a
        where a.client_id = client
          and a.coach_id = me.id
          and a.organization_id = me.organization_id)
      else false
    end
    from me
  ), false);
$fn$;

-- Write gate for staff acting on a client's behalf. Deliberately excludes the
-- client themselves; client self-writes get their own narrower policies.
create or replace function public.can_manage_client(client uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  with me as (
    select id, organization_id, role from public.profiles where auth_user_id = auth.uid() limit 1
  )
  select coalesce((
    select case
      when me.role = 'organization_owner' then exists (
        select 1 from public.profiles c
        where c.id = client and c.organization_id = me.organization_id)
      when me.role = 'coach' then exists (
        select 1 from public.coach_client_assignments a
        where a.client_id = client and a.coach_id = me.id and a.organization_id = me.organization_id)
      else false
    end
    from me
  ), false);
$fn$;
