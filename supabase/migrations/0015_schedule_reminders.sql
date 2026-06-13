-- ============================================================
-- Timesheet — Schedule the "pending > 1 week" reminder emails
-- Apply in Supabase: SQL Editor → paste → Run.
--
-- Runs the remind-pending edge function once a day. It emails approvers about
-- timesheets that have been pending more than a week (at most one reminder per
-- approval per week — see the function + 0014_approval_age.sql).
--
-- BEFORE RUNNING, replace:
--   <PROJECT_REF>   your project ref (Settings → General), e.g. abcd1234
--   <CRON_SECRET>   the same value you set as the function's CRON_SECRET env
--                   (Edge Functions → remind-pending → Secrets). Optional but
--                   recommended; if you didn't set one, delete that header line.
--
-- Requires the pg_cron and pg_net extensions (enable under Database →
-- Extensions if not already on).
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous schedule with this name, then (re)create it.
select cron.unschedule('remind-pending-daily')
where exists (select 1 from cron.job where jobname = 'remind-pending-daily');

select cron.schedule(
  'remind-pending-daily',
  '0 8 * * *',                      -- every day at 08:00 UTC
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/remind-pending',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', '<CRON_SECRET>'
               ),
    body    := '{}'::jsonb
  );
  $$
);
