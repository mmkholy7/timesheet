-- ============================================================
-- Timesheet — Phase 3: restore policies that 0002 dropped by mistake
-- Apply in Supabase: SQL Editor → paste → Run.
--
-- 0002 ran `drop table approver_links cascade`, and CASCADE also dropped the
-- RLS policies on OTHER tables whose USING clause referenced approver_links:
--   • profiles.profiles_select   (→ app couldn't read any profile → no role → no Admin tab)
--   • timesheets.timesheets_read_mgr  (→ approver couldn't see employees' timesheets)
-- 0002 only recreated the link/approval/entry policies, so these two were lost.
-- This migration recreates them. Safe to re-run.
-- ============================================================

-- profiles: read self / admin / linked counterpart
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or is_admin()
  or exists (select 1 from approver_links l
             where (l.manager_id = auth.uid() and l.employee_id = profiles.id)
                or (l.employee_id = auth.uid() and l.manager_id  = profiles.id))
);

-- timesheets: admin or a linked manager may read an employee's sheets
drop policy if exists timesheets_read_mgr on timesheets;
create policy timesheets_read_mgr on timesheets for select using (
  is_admin()
  or exists (select 1 from approver_links l
             where l.manager_id = auth.uid() and l.employee_id = timesheets.user_id)
);
