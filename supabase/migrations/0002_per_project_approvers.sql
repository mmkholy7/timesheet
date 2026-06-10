-- ============================================================
-- Timesheet — Phase 2: approvers per PROJECT (was per customer)
-- Apply in Supabase: SQL Editor → paste → Run.
-- Re-runnable. Drops & recreates approver_links + approvals so they
-- key on project_id instead of customer_id. (Approval data is test-only.)
-- ============================================================

-- Policies on these tables reference can_approve(); drop them first so we
-- can replace the function signature cleanly.
drop policy if exists entries_read_mgr on timesheet_entries;
drop policy if exists approvals_select on approvals;
drop policy if exists approvals_insert on approvals;
drop policy if exists approvals_decide on approvals;
drop policy if exists links_select on approver_links;
drop policy if exists links_write on approver_links;

drop table if exists approvals cascade;
drop table if exists approver_links cascade;

-- ---------- Tables (now keyed on project_id) ----------

create table approver_links (
  id          uuid primary key default gen_random_uuid(),
  manager_id  uuid not null references profiles(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (manager_id, employee_id, project_id)
);

create table approvals (
  id           uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references timesheets(id) on delete cascade,
  project_id   uuid not null references projects(id),
  status       text not null default 'Pending'
               check (status in ('Pending','Approved','Rejected')),
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  comment      text,
  unique (timesheet_id, project_id)
);

-- ---------- can_approve now checks a project link ----------

drop function if exists can_approve(uuid, uuid);
create or replace function can_approve(p_employee uuid, p_project uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from approver_links
    where manager_id  = auth.uid()
      and employee_id = p_employee
      and project_id  = p_project
  );
$$;

-- ---------- RLS ----------

alter table approver_links enable row level security;
alter table approvals      enable row level security;

-- approver_links: self (either side) or admin reads; admin writes
create policy links_select on approver_links for select using (
  manager_id = auth.uid() or employee_id = auth.uid() or is_admin()
);
create policy links_write on approver_links for all using (is_admin()) with check (is_admin());

-- entries: manager reads ONLY rows for projects they approve for this employee
create policy entries_read_mgr on timesheet_entries for select using (
  is_admin()
  or exists (
    select 1 from timesheets t
    where t.id = timesheet_entries.timesheet_id
      and can_approve(t.user_id, timesheet_entries.project_id)
  )
);

-- approvals: employee (owner) & approving manager & admin read; owner creates; manager decides
create policy approvals_select on approvals for select using (
  is_admin()
  or exists (select 1 from timesheets t
             where t.id = approvals.timesheet_id and t.user_id = auth.uid())
  or can_approve((select user_id from timesheets where id = approvals.timesheet_id),
                 approvals.project_id)
);
create policy approvals_insert on approvals for insert with check (
  exists (select 1 from timesheets t
          where t.id = approvals.timesheet_id and t.user_id = auth.uid())
);
create policy approvals_decide on approvals for update using (
  is_admin()
  or can_approve((select user_id from timesheets where id = approvals.timesheet_id),
                 approvals.project_id)
);

grant select, insert, update, delete on approver_links, approvals to authenticated;

-- ---------- Allow the service role (edge functions) to set roles ----------
-- The role guard from 0001 calls is_admin(), which is false in the service-role
-- context the `invite-approver` function runs in. Allow service_role through so
-- it can promote a freshly invited approver to 'manager'.
create or replace function guard_profile_role()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.role is distinct from old.role
     and not is_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only an admin can change role';
  end if;
  return new;
end;
$$;
