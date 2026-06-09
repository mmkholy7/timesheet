-- Run this in Supabase Dashboard → SQL Editor

create table if not exists timesheets (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users not null,
  week_start  date        not null,
  status      text        default 'Draft',
  rows        jsonb       not null default '[]',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique(user_id, week_start)
);

-- Enable Row Level Security (users only see their own rows)
alter table timesheets enable row level security;

create policy "Users manage own timesheets"
  on timesheets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Optional: auto-update updated_at on every save
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger timesheets_updated_at
  before update on timesheets
  for each row execute procedure update_updated_at();
