-- ============================================================================
-- Nell 0006 — Row Level Security
--
-- Rules of the house:
--   * Every tenant table has RLS enabled and an explicit policy. There is no
--     "default allow" anywhere.
--   * Tenancy is always derived from auth.uid() via the helpers in 0001. The
--     application never supplies its own organization_id to a policy.
--   * Coaches see only clients explicitly assigned to them.
--   * Clients see only their own rows, and never see coach-private material
--     (notes, alerts, risk snapshots, briefs).
--   * The service role bypasses RLS by design; it is used only in trusted
--     server code (signup, invitations, webhooks, nightly jobs, seeding).
-- ============================================================================

alter table public.organizations            enable row level security;
alter table public.profiles                 enable row level security;
alter table public.coach_client_assignments enable row level security;
alter table public.frameworks               enable row level security;
alter table public.framework_steps          enable row level security;
alter table public.exercises                enable row level security;
alter table public.exercise_assignments     enable row level security;
alter table public.exercise_entries         enable row level security;
alter table public.exercise_responses       enable row level security;
alter table public.reason_codes             enable row level security;
alter table public.commitments              enable row level security;
alter table public.commitment_checkins      enable row level security;
alter table public.patterns                 enable row level security;
alter table public.coach_alerts             enable row level security;
alter table public.client_status_snapshots  enable row level security;
alter table public.coaching_briefs          enable row level security;
alter table public.experiments              enable row level security;
alter table public.coach_notes              enable row level security;
alter table public.organization_ai_settings enable row level security;
alter table public.invitations              enable row level security;
alter table public.audit_logs               enable row level security;
alter table public.ai_usage_events          enable row level security;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
  using (id = public.current_org_id() or public.is_super_admin());

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update to authenticated
  using (public.is_org_owner(id) or public.is_super_admin())
  with check (public.is_org_owner(id) or public.is_super_admin());

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = public.current_profile_id()
    or public.is_super_admin()
    or (
      organization_id = public.current_org_id()
      and (
        -- staff colleagues are visible to everyone in the org
        role in ('organization_owner', 'coach')
        -- client rows are visible only to staff who may access that client
        or public.can_access_client(id)
      )
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = public.current_profile_id())
  with check (id = public.current_profile_id());

drop policy if exists profiles_update_staff on public.profiles;
create policy profiles_update_staff on public.profiles for update to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- coach_client_assignments
-- ---------------------------------------------------------------------------
drop policy if exists cca_select on public.coach_client_assignments;
create policy cca_select on public.coach_client_assignments for select to authenticated
  using (
    coach_id = public.current_profile_id()
    or client_id = public.current_profile_id()
    or public.is_org_owner(organization_id)
  );

drop policy if exists cca_write on public.coach_client_assignments;
create policy cca_write on public.coach_client_assignments for all to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- Org-scoped configuration: readable by every member (clients need it to
-- render their own exercises), writable by staff only.
-- ---------------------------------------------------------------------------
drop policy if exists frameworks_select on public.frameworks;
create policy frameworks_select on public.frameworks for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists frameworks_write on public.frameworks;
create policy frameworks_write on public.frameworks for all to authenticated
  using (public.is_org_staff(organization_id))
  with check (public.is_org_staff(organization_id));

drop policy if exists framework_steps_select on public.framework_steps;
create policy framework_steps_select on public.framework_steps for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists framework_steps_write on public.framework_steps;
create policy framework_steps_write on public.framework_steps for all to authenticated
  using (public.is_org_staff(organization_id))
  with check (public.is_org_staff(organization_id));

drop policy if exists exercises_select on public.exercises;
create policy exercises_select on public.exercises for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists exercises_write on public.exercises;
create policy exercises_write on public.exercises for all to authenticated
  using (public.is_org_staff(organization_id))
  with check (public.is_org_staff(organization_id));

drop policy if exists reason_codes_select on public.reason_codes;
create policy reason_codes_select on public.reason_codes for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists reason_codes_write on public.reason_codes;
create policy reason_codes_write on public.reason_codes for all to authenticated
  using (public.is_org_staff(organization_id))
  with check (public.is_org_staff(organization_id));

-- ---------------------------------------------------------------------------
-- exercise_assignments
-- ---------------------------------------------------------------------------
drop policy if exists exercise_assignments_select on public.exercise_assignments;
create policy exercise_assignments_select on public.exercise_assignments for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists exercise_assignments_write on public.exercise_assignments;
create policy exercise_assignments_write on public.exercise_assignments for all to authenticated
  using (public.can_manage_client(client_id))
  with check (public.can_manage_client(client_id));

-- ---------------------------------------------------------------------------
-- exercise_entries — clients create and complete their own
-- ---------------------------------------------------------------------------
drop policy if exists exercise_entries_select on public.exercise_entries;
create policy exercise_entries_select on public.exercise_entries for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists exercise_entries_insert_self on public.exercise_entries;
create policy exercise_entries_insert_self on public.exercise_entries for insert to authenticated
  with check (client_id = public.current_profile_id() and organization_id = public.current_org_id());

drop policy if exists exercise_entries_update_self on public.exercise_entries;
create policy exercise_entries_update_self on public.exercise_entries for update to authenticated
  using (client_id = public.current_profile_id())
  with check (client_id = public.current_profile_id());

-- ---------------------------------------------------------------------------
-- exercise_responses — reachable only through an entry the caller may see
-- ---------------------------------------------------------------------------
drop policy if exists exercise_responses_select on public.exercise_responses;
create policy exercise_responses_select on public.exercise_responses for select to authenticated
  using (exists (
    select 1 from public.exercise_entries e
    where e.id = exercise_responses.entry_id and public.can_access_client(e.client_id)
  ));

drop policy if exists exercise_responses_insert_self on public.exercise_responses;
create policy exercise_responses_insert_self on public.exercise_responses for insert to authenticated
  with check (exists (
    select 1 from public.exercise_entries e
    where e.id = exercise_responses.entry_id and e.client_id = public.current_profile_id()
  ));

drop policy if exists exercise_responses_update_self on public.exercise_responses;
create policy exercise_responses_update_self on public.exercise_responses for update to authenticated
  using (exists (
    select 1 from public.exercise_entries e
    where e.id = exercise_responses.entry_id and e.client_id = public.current_profile_id()
  ))
  with check (exists (
    select 1 from public.exercise_entries e
    where e.id = exercise_responses.entry_id and e.client_id = public.current_profile_id()
  ));

-- ---------------------------------------------------------------------------
-- commitments — the client owns them; staff may read and adjust
-- ---------------------------------------------------------------------------
drop policy if exists commitments_select on public.commitments;
create policy commitments_select on public.commitments for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists commitments_insert_self on public.commitments;
create policy commitments_insert_self on public.commitments for insert to authenticated
  with check (client_id = public.current_profile_id() and organization_id = public.current_org_id());

drop policy if exists commitments_update_self on public.commitments;
create policy commitments_update_self on public.commitments for update to authenticated
  using (client_id = public.current_profile_id())
  with check (client_id = public.current_profile_id());

drop policy if exists commitments_write_staff on public.commitments;
create policy commitments_write_staff on public.commitments for all to authenticated
  using (public.can_manage_client(client_id))
  with check (public.can_manage_client(client_id));

-- ---------------------------------------------------------------------------
-- commitment_checkins
-- ---------------------------------------------------------------------------
drop policy if exists checkins_select on public.commitment_checkins;
create policy checkins_select on public.commitment_checkins for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists checkins_insert_self on public.commitment_checkins;
create policy checkins_insert_self on public.commitment_checkins for insert to authenticated
  with check (client_id = public.current_profile_id() and organization_id = public.current_org_id());

drop policy if exists checkins_update_self on public.commitment_checkins;
create policy checkins_update_self on public.commitment_checkins for update to authenticated
  using (client_id = public.current_profile_id())
  with check (client_id = public.current_profile_id());

-- ---------------------------------------------------------------------------
-- patterns — clients see their own confirmed insights, staff see everything
-- including candidates still under review.
-- ---------------------------------------------------------------------------
drop policy if exists patterns_select on public.patterns;
create policy patterns_select on public.patterns for select to authenticated
  using (
    -- Staff see everything, including candidates still under review.
    (public.is_org_staff(organization_id) and public.can_access_client(client_id))
    -- The client sees only their own, and only once confirmed. Parenthesised
    -- explicitly: AND binds tighter than OR, and this is a security boundary
    -- that should not depend on the reader remembering that.
    or (client_id = public.current_profile_id() and status = 'active')
  );

drop policy if exists patterns_write_staff on public.patterns;
create policy patterns_write_staff on public.patterns for all to authenticated
  using (public.can_manage_client(client_id))
  with check (public.can_manage_client(client_id));

-- ---------------------------------------------------------------------------
-- Coach-private material. Clients have no policy here at all, so they cannot
-- read alerts, risk snapshots, briefs or notes about themselves.
-- ---------------------------------------------------------------------------
drop policy if exists coach_alerts_staff on public.coach_alerts;
create policy coach_alerts_staff on public.coach_alerts for all to authenticated
  using (public.is_org_staff(organization_id) and public.can_access_client(client_id))
  with check (public.is_org_staff(organization_id) and public.can_access_client(client_id));

drop policy if exists snapshots_staff on public.client_status_snapshots;
create policy snapshots_staff on public.client_status_snapshots for all to authenticated
  using (public.is_org_staff(organization_id) and public.can_access_client(client_id))
  with check (public.is_org_staff(organization_id) and public.can_access_client(client_id));

drop policy if exists briefs_staff on public.coaching_briefs;
create policy briefs_staff on public.coaching_briefs for all to authenticated
  using (public.is_org_staff(organization_id) and public.can_access_client(client_id))
  with check (public.is_org_staff(organization_id) and public.can_access_client(client_id));

drop policy if exists coach_notes_staff on public.coach_notes;
create policy coach_notes_staff on public.coach_notes for all to authenticated
  using (public.is_org_staff(organization_id) and public.can_access_client(client_id))
  with check (public.is_org_staff(organization_id) and public.can_access_client(client_id));

-- ---------------------------------------------------------------------------
-- experiments — run jointly, so the client can see their own
-- ---------------------------------------------------------------------------
drop policy if exists experiments_select on public.experiments;
create policy experiments_select on public.experiments for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists experiments_write_staff on public.experiments;
create policy experiments_write_staff on public.experiments for all to authenticated
  using (public.can_manage_client(client_id))
  with check (public.can_manage_client(client_id));

-- ---------------------------------------------------------------------------
-- organization_ai_settings
-- ---------------------------------------------------------------------------
drop policy if exists org_ai_settings_select on public.organization_ai_settings;
create policy org_ai_settings_select on public.organization_ai_settings for select to authenticated
  using (public.is_org_staff(organization_id));

drop policy if exists org_ai_settings_write on public.organization_ai_settings;
create policy org_ai_settings_write on public.organization_ai_settings for all to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- invitations / audit_logs / ai_usage_events
-- ---------------------------------------------------------------------------
drop policy if exists invitations_staff on public.invitations;
create policy invitations_staff on public.invitations for all to authenticated
  using (public.is_org_staff(organization_id))
  with check (public.is_org_staff(organization_id));

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_org_owner(organization_id) or public.is_super_admin());

drop policy if exists ai_usage_select on public.ai_usage_events;
create policy ai_usage_select on public.ai_usage_events for select to authenticated
  using (public.is_org_owner(organization_id) or public.is_super_admin());
