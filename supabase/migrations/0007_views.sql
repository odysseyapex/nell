-- ============================================================================
-- Nell 0007 — Reporting helpers
--
-- The metric maths lives in TypeScript (src/lib/metrics) so it can be unit
-- tested without a database. What lives here is the flattening: one row per
-- commitment carrying its outcome and reason, which is what every metric,
-- pattern rule and brief reads from.
--
-- The view is declared with security_invoker so it inherits the RLS policies
-- of the underlying tables rather than running as its owner.
-- ============================================================================

create or replace view public.commitment_facts
with (security_invoker = true) as
select
  c.id                        as commitment_id,
  c.organization_id,
  c.client_id,
  c.commitment_text,
  c.commitment_category,
  c.commitment_date,
  c.due_at,
  c.confidence_score,
  c.status,
  c.created_at,
  c.created_hour_local,
  extract(isodow from c.commitment_date)::int as weekday,          -- 1 = Monday
  (extract(isodow from c.commitment_date)::int >= 6) as is_weekend,
  ci.outcome,
  ci.checked_in_at,
  ci.emotion,
  ci.reason_code_id,
  rc.slug                     as reason_slug,
  rc.name                     as reason_name,
  rc.category                 as reason_category
from public.commitments c
left join public.commitment_checkins ci on ci.commitment_id = c.id
left join public.reason_codes rc on rc.id = ci.reason_code_id;

comment on view public.commitment_facts is
  'One row per commitment with its outcome and reason attached. Source of truth for metrics and pattern rules.';

-- ---------------------------------------------------------------------------
-- Active client count, used for plan-limit enforcement at invite time.
-- ---------------------------------------------------------------------------
create or replace function public.org_active_client_count(org uuid)
returns integer language sql stable security definer set search_path = public as $fn$
  select count(*)::int
  from public.profiles
  where organization_id = org and role = 'client' and status in ('active', 'invited');
$fn$;
