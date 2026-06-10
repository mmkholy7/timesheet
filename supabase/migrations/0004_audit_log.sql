-- ============================================================
-- Timesheet — Phase 4: audit log
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
-- Captures who did what, to which entity, with details + client IP.
-- Identity + IP are stamped server-side by a trigger so the client can't spoof.
-- ============================================================

-- Best-effort client IP from the request headers PostgREST exposes.
create or replace function client_ip()
returns text language sql stable set search_path = public as $$
  select coalesce(
    nullif(split_part(h ->> 'x-forwarded-for', ',', 1), ''),
    h ->> 'cf-connecting-ip',
    h ->> 'x-real-ip'
  )
  from (select nullif(current_setting('request.headers', true), '')::json as h) s
$$;

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references profiles(id) on delete set null,
  user_email  text,
  user_role   text,
  action      text not null,        -- e.g. 'timesheet: submitted'
  entity_type text,                 -- e.g. 'timesheet' | 'approval' | 'user'
  entity_id   text,
  details     jsonb,
  ip          text
);

create index if not exists audit_log_created_idx on audit_log (created_at desc);

-- Stamp identity + IP from the auth context, ignoring whatever the client sent.
create or replace function audit_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id    := auth.uid();
  new.user_email := (select email from profiles where id = auth.uid());
  new.user_role  := (select role  from profiles where id = auth.uid());
  new.ip         := client_ip();
  return new;
end;
$$;

drop trigger if exists audit_fill_trg on audit_log;
create trigger audit_fill_trg before insert on audit_log
  for each row execute function audit_fill();

alter table audit_log enable row level security;

-- Any signed-in user may append (the trigger forces the row to be about them);
-- only admins may read the log.
drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert with check (auth.uid() is not null);
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (is_admin());

grant insert, select on audit_log to authenticated;
