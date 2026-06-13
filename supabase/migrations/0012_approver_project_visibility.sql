-- ============================================================
-- Timesheet — Let approvers see the project/customer they approve, and
-- backfill the approver email onto past approvals.
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
--
-- Approvers are often in a DIFFERENT org than the project's customer
-- (e.g. a WSP approver approving time on a WSP customer that lives under the
-- uably tenant). Org-scoped RLS on projects/customers therefore hid the
-- project code from the approver — their queue showed hours but a blank
-- Project column, and the approved PDF had no project/customer.
--
-- Fix: also allow reading a project (and its customer) when the caller is an
-- assigned approver for that project. Plus backfill decided_by_email so the
-- employee's invoice PDF shows who approved, even for older approvals.
-- ============================================================

-- decided_by_email may not exist yet if 0011 wasn't applied — add idempotently.
alter table approvals add column if not exists decided_by_email text;

-- ---------- projects: approver of the project may read it ----------
drop policy if exists projects_select on projects;
create policy projects_select on projects for select using (
  is_admin()
  or exists (
    select 1 from customers c
    where c.id = projects.customer_id
      and c.organization_id = my_org_id()
  )
  or exists (
    select 1 from approver_links al
    where al.manager_id = auth.uid()
      and al.project_id = projects.id
  )
);

-- ---------- customers: approver of any of its projects may read it ----------
drop policy if exists customers_select on customers;
create policy customers_select on customers for select using (
  is_admin()
  or organization_id = my_org_id()
  or exists (
    select 1 from approver_links al
    join projects p on p.id = al.project_id
    where al.manager_id = auth.uid()
      and p.customer_id = customers.id
  )
);

-- ---------- Backfill approver email on existing approvals ----------
update approvals a
set decided_by_email = p.email
from profiles p
where a.decided_by = p.id
  and a.decided_by_email is null;
