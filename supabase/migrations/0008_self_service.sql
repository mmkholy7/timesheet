-- ============================================================
-- Timesheet — Self-service features
-- Apply in Supabase: SQL Editor → paste → Run. Re-runnable.
--
-- 1) Any signed-in user can add a project code (was admin-only).
-- 2) A timesheet owner can recall a submitted week: this deletes the
--    related approval rows, so the owner needs DELETE on approvals.
-- ============================================================

-- ---------- 1) Self-service project creation ----------
-- Keep the admin-only `projects_write` (covers update/delete) and add a
-- separate INSERT policy for everyone authenticated. RLS OR's permissive
-- policies, so either admin OR any signed-in user may insert.
drop policy if exists projects_insert on projects;
create policy projects_insert on projects for insert
  with check (auth.uid() is not null);

-- ---------- 2) Owner can delete their approval rows (for Recall) ----------
-- Existing policies only let the owner INSERT and the manager/admin UPDATE.
-- Recall pulls a week back to Draft and removes its routed approvals, so the
-- timesheet owner needs DELETE on the approvals that belong to their sheet.
drop policy if exists approvals_owner_delete on approvals;
create policy approvals_owner_delete on approvals for delete using (
  is_admin()
  or exists (select 1 from timesheets t
             where t.id = approvals.timesheet_id and t.user_id = auth.uid())
);
