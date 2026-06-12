-- ============================================================
-- Timesheet — Give org-less users an organization
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
--
-- Projects/customers are org-scoped (migration 0005), so a user with no
-- organization_id sees an EMPTY project list and can't submit a timesheet.
-- New users were being created without an org. This backfills every org-less
-- profile to the operator tenant (uably) so they can log time again. An admin
-- can reassign anyone afterwards from Admin → Users → Organization.
-- ============================================================

update profiles
set organization_id = (select id from organizations where slug = 'uably')
where organization_id is null;
