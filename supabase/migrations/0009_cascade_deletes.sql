-- ============================================================
-- Timesheet — Hard-delete support for Org / Customer / Project admin
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
--
-- Admins can now permanently delete a project, customer, or organization.
-- These FKs previously had no ON DELETE action, so deleting a row that had
-- logged hours / approvals / child rows would fail. Re-point them to CASCADE
-- (or SET NULL for profiles) so a delete cleans up everything beneath it.
--
--   organizations ─cascade→ customers ─cascade→ projects ─cascade→
--      timesheet_entries / approvals / approver_links
--   organizations ─set null→ profiles.organization_id (users are kept)
-- ============================================================

-- project → timesheet_entries
alter table timesheet_entries drop constraint if exists timesheet_entries_project_id_fkey;
alter table timesheet_entries add constraint timesheet_entries_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;

-- project → approvals
alter table approvals drop constraint if exists approvals_project_id_fkey;
alter table approvals add constraint approvals_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;

-- (projects.customer_id and approver_links.project_id are already ON DELETE CASCADE)

-- organization → customers (so deleting an org removes its customers/projects)
alter table customers drop constraint if exists customers_organization_id_fkey;
alter table customers add constraint customers_organization_id_fkey
  foreign key (organization_id) references organizations(id) on delete cascade;

-- organization → profiles: keep the users, just un-assign them
alter table profiles drop constraint if exists profiles_organization_id_fkey;
alter table profiles add constraint profiles_organization_id_fkey
  foreign key (organization_id) references organizations(id) on delete set null;
