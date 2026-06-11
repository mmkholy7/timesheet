-- ============================================================
-- Timesheet — Multi-tenant Phase 1: org isolation
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
--
-- Changes:
--   1. New `organizations` table — each company using the SaaS is one row.
--   2. `profiles.organization_id`  — every user belongs to one org.
--   3. `customers.organization_id` — customers (e.g. WSP) are per-org.
--   4. Helper `my_org_id()` — returns the caller's org UUID.
--   5. Updated RLS on customers, projects, profiles, timesheets so data
--      never leaks across org boundaries.
--   6. Seed: uably org created; WSP customer + admin user linked to it.
--
-- Order matters: columns must exist before my_org_id() is created,
-- and my_org_id() must exist before any policy that references it.
-- ============================================================

-- ---------- 1. Organizations table (no policies yet) ----------

create table if not exists organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,   -- url-safe identifier, e.g. "uably"
  created_at timestamptz not null default now()
);

alter table organizations enable row level security;

grant select, insert, update, delete on organizations to authenticated;

-- ---------- 2. Add organization_id columns ----------
-- Must happen before my_org_id() is defined so the column exists when the
-- function body is compiled.

alter table profiles   add column if not exists organization_id uuid references organizations(id);
alter table customers  add column if not exists organization_id uuid references organizations(id);

-- ---------- 3. Helper: caller's org ----------
-- SECURITY DEFINER bypasses RLS on profiles so the function can always read
-- the caller's own row without circular policy evaluation.

create or replace function my_org_id()
returns uuid language sql security definer stable
set search_path = public as $$
  select organization_id from profiles where id = auth.uid();
$$;

-- ---------- 4. RLS: organizations ----------

drop policy if exists orgs_select on organizations;
create policy orgs_select on organizations for select using (
  is_admin()
  or id = my_org_id()
);

drop policy if exists orgs_write on organizations;
create policy orgs_write on organizations for all
  using (is_admin()) with check (is_admin());

-- ---------- 5. RLS: customers — scoped to caller's org ----------

drop policy if exists customers_select on customers;
create policy customers_select on customers for select using (
  is_admin()
  or organization_id = my_org_id()
);
drop policy if exists customers_write on customers;
create policy customers_write on customers for all
  using (is_admin()) with check (is_admin());

-- ---------- 6. RLS: projects — scoped through customer → org ----------

drop policy if exists projects_select on projects;
create policy projects_select on projects for select using (
  is_admin()
  or exists (
    select 1 from customers c
    where c.id = projects.customer_id
      and c.organization_id = my_org_id()
  )
);
drop policy if exists projects_write on projects;
create policy projects_write on projects for all
  using (is_admin()) with check (is_admin());

-- ---------- 7. RLS: profiles — only see colleagues in same org ----------

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or is_admin()
  or (
    organization_id = my_org_id()
    and exists (
      select 1 from approver_links l
      where (l.manager_id = auth.uid() and l.employee_id = profiles.id)
         or (l.employee_id = auth.uid() and l.manager_id  = profiles.id)
    )
  )
);

-- ---------- 8. RLS: timesheets — manager sees only same-org employees ----------

drop policy if exists timesheets_read_mgr on timesheets;
create policy timesheets_read_mgr on timesheets for select using (
  is_admin()
  or exists (
    select 1 from approver_links l
    join profiles p on p.id = timesheets.user_id
    where l.manager_id      = auth.uid()
      and l.employee_id     = timesheets.user_id
      and p.organization_id = my_org_id()
  )
);

-- ---------- 9. Seed ----------

-- uably — the SaaS operator tenant
insert into organizations (name, slug)
values ('uably', 'uably')
on conflict (slug) do nothing;

-- Link WSP customer to uably
update customers
set organization_id = (select id from organizations where slug = 'uably')
where name = 'WSP'
  and organization_id is null;

-- Link the admin user to uably
update profiles
set organization_id = (select id from organizations where slug = 'uably')
where lower(email) = 'melkhouly@uably.com'
  and organization_id is null;
