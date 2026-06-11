-- ============================================================
-- Timesheet — Add logo_url to organizations
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
-- ============================================================

alter table organizations add column if not exists logo_url text;

-- WSP is a customer of uably, not a tenant logo.
-- The uably org has no custom logo yet (null = show generic app icon).
-- Admins can set this later via the Admin UI.
