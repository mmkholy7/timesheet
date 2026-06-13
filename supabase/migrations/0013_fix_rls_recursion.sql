-- ============================================================
-- Timesheet — Fix infinite-recursion in customers/projects RLS
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
--
-- 0012 added an approver clause to customers_select that selects from
-- projects, while projects_select already selects from customers. Postgres
-- then recurses between the two policies and aborts every read with
-- "infinite recursion detected in policy", so customers and projects came
-- back EMPTY everywhere (admin lists, the employee's project dropdown, etc.).
--
-- Fix: do the approver→customer check inside a SECURITY DEFINER function,
-- which runs with RLS disabled, so the policy no longer recurses into
-- projects. (No data was lost — the rows were just unreadable.)
-- ============================================================

create or replace function is_customer_approver(p_customer uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1
    from approver_links al
    join projects p on p.id = al.project_id
    where al.manager_id = auth.uid()
      and p.customer_id = p_customer
  );
$$;

drop policy if exists customers_select on customers;
create policy customers_select on customers for select using (
  is_admin()
  or organization_id = my_org_id()
  or is_customer_approver(customers.id)
);

-- projects_select (from 0012) is fine as-is: its approver clause only reads
-- approver_links (no recursion), and its org clause reads customers, whose
-- policy no longer reads projects. Left unchanged.
