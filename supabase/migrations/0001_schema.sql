-- ============================================================
-- Timesheet — Phase 1 schema, RLS, triggers, seed
-- Apply in Supabase: SQL Editor → paste → Run.
-- Safe to re-run (idempotent where practical).
-- ============================================================

-- ---------- Replace legacy timesheets table ----------
-- The original app stored a whole week as one JSONB `rows` blob with its own
-- RLS policies. We're moving to normalized timesheet_entries, so drop the old
-- table (and anything depending on it). Confirmed empty before writing this.
-- WARNING: this deletes the old `timesheets` table and any rows in it.
drop table if exists timesheet_entries cascade;
drop table if exists approvals cascade;
drop table if exists timesheets cascade;

-- ---------- Tables ----------

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'employee'
              check (role in ('employee','manager','admin')),
  created_at  timestamptz not null default now()
);

create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,            -- e.g. "WSP"
  code        text,
  created_at  timestamptz not null default now()
);

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  code        text not null,            -- full project code string
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists timesheets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  week_start  date not null,
  status      text not null default 'Draft' check (status in ('Draft','Submitted')),
  updated_at  timestamptz not null default now(),
  unique (user_id, week_start)
);

create table if not exists timesheet_entries (
  id            uuid primary key default gen_random_uuid(),
  timesheet_id  uuid not null references timesheets(id) on delete cascade,
  project_id    uuid not null references projects(id),
  rate          text not null,
  hours         numeric[7] not null default '{0,0,0,0,0,0,0}',  -- Sat..Fri
  created_at    timestamptz not null default now()
);

create table if not exists approver_links (
  id          uuid primary key default gen_random_uuid(),
  manager_id  uuid not null references profiles(id) on delete cascade,
  employee_id uuid not null references profiles(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (manager_id, employee_id, customer_id)
);

create table if not exists approvals (
  id           uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references timesheets(id) on delete cascade,
  customer_id  uuid not null references customers(id),
  status       text not null default 'Pending'
               check (status in ('Pending','Approved','Rejected')),
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  comment      text,
  unique (timesheet_id, customer_id)
);

-- ---------- Helper functions (SECURITY DEFINER avoids recursive RLS) ----------

create or replace function is_admin()
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function can_approve(p_employee uuid, p_customer uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from approver_links
    where manager_id  = auth.uid()
      and employee_id = p_employee
      and customer_id = p_customer
  );
$$;

-- ---------- Auto-create profile on signup/invite ----------

create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Block non-admins from changing their own role ----------

create or replace function guard_profile_role()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    raise exception 'Only an admin can change role';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on profiles;
create trigger profiles_role_guard
  before update on profiles
  for each row execute function guard_profile_role();

-- ---------- Enable RLS ----------

alter table profiles          enable row level security;
alter table customers         enable row level security;
alter table projects          enable row level security;
alter table timesheets        enable row level security;
alter table timesheet_entries enable row level security;
alter table approver_links    enable row level security;
alter table approvals         enable row level security;

-- ---------- Policies ----------

-- profiles: read self / linked / admin; update self or admin (role guarded by trigger)
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or is_admin()
  or exists (select 1 from approver_links l
             where (l.manager_id = auth.uid() and l.employee_id = profiles.id)
                or (l.employee_id = auth.uid() and l.manager_id  = profiles.id))
);
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_admin());

-- customers / projects: everyone authenticated reads; admins write
drop policy if exists customers_select on customers;
create policy customers_select on customers for select using (auth.uid() is not null);
drop policy if exists customers_write on customers;
create policy customers_write on customers for all using (is_admin()) with check (is_admin());

drop policy if exists projects_select on projects;
create policy projects_select on projects for select using (auth.uid() is not null);
drop policy if exists projects_write on projects;
create policy projects_write on projects for all using (is_admin()) with check (is_admin());

-- timesheets: owner full control; manager (any linked customer) & admin read
drop policy if exists timesheets_owner on timesheets;
create policy timesheets_owner on timesheets for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists timesheets_read_mgr on timesheets;
create policy timesheets_read_mgr on timesheets for select using (
  is_admin()
  or exists (select 1 from approver_links l
             where l.manager_id = auth.uid() and l.employee_id = timesheets.user_id)
);

-- entries: owner full control; manager reads ONLY linked-employee + linked-customer rows
drop policy if exists entries_owner on timesheet_entries;
create policy entries_owner on timesheet_entries for all
  using (exists (select 1 from timesheets t
                 where t.id = timesheet_entries.timesheet_id and t.user_id = auth.uid()))
  with check (exists (select 1 from timesheets t
                 where t.id = timesheet_entries.timesheet_id and t.user_id = auth.uid()));
drop policy if exists entries_read_mgr on timesheet_entries;
create policy entries_read_mgr on timesheet_entries for select using (
  is_admin()
  or exists (
    select 1 from timesheets t
    join projects p on p.id = timesheet_entries.project_id
    where t.id = timesheet_entries.timesheet_id
      and can_approve(t.user_id, p.customer_id)
  )
);

-- approver_links: self (either side) or admin reads; admin writes
drop policy if exists links_select on approver_links;
create policy links_select on approver_links for select using (
  manager_id = auth.uid() or employee_id = auth.uid() or is_admin()
);
drop policy if exists links_write on approver_links;
create policy links_write on approver_links for all using (is_admin()) with check (is_admin());

-- approvals: employee (owner) & manager & admin read; owner creates Pending; manager decides
drop policy if exists approvals_select on approvals;
create policy approvals_select on approvals for select using (
  is_admin()
  or exists (select 1 from timesheets t
             where t.id = approvals.timesheet_id and t.user_id = auth.uid())
  or can_approve((select user_id from timesheets where id = approvals.timesheet_id),
                 approvals.customer_id)
);
drop policy if exists approvals_insert on approvals;
create policy approvals_insert on approvals for insert with check (
  exists (select 1 from timesheets t
          where t.id = approvals.timesheet_id and t.user_id = auth.uid())
);
drop policy if exists approvals_decide on approvals;
create policy approvals_decide on approvals for update using (
  is_admin()
  or can_approve((select user_id from timesheets where id = approvals.timesheet_id),
                 approvals.customer_id)
);

-- ---------- Grants (RLS still governs row visibility) ----------

grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------- Backfill existing auth users + bootstrap admin ----------

insert into profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- make yourself admin (auth stores email lowercased)
update profiles set role = 'admin' where lower(email) = 'melkhouly@uably.com';

-- ---------- Seed: WSP customer + the two project codes from your screen ----------

insert into customers (name, code) values ('WSP', 'WSP')
on conflict do nothing;

insert into projects (customer_id, code, description)
select c.id, v.code, v.description
from customers c,
     (values
        ('IDGC1000567 - INVEST_GLB_ISRC - IT Risk & Compliance - 26.03.04 - 2026_PROJECT_CTP-04-Serv Hard-Cyber Transformation Program',
         'IT Risk & Compliance'),
        ('IDCA1000166 - IDCA-CA010198-WSP-CORP-Quebec-Health & Safety-ProjDlvEx - 100 - Overhead Expenses',
         'Health & Safety')
     ) as v(code, description)
where c.name = 'WSP'
  and not exists (select 1 from projects p where p.code = v.code);
