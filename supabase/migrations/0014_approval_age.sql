-- ============================================================
-- Timesheet — Track how long an approval has been pending
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
--
-- Needed for the "pending more than a week" reminder (in-app + email):
--   created_at  — when the approval was routed (resubmitting recreates the
--                 row, so this restarts the clock, which is what we want).
--   reminded_at — last time a reminder email went out, so the scheduled job
--                 doesn't email every day.
-- ============================================================

alter table approvals add column if not exists created_at  timestamptz not null default now();
alter table approvals add column if not exists reminded_at timestamptz;
