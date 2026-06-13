-- ============================================================
-- Timesheet — Store the approver's email on the approval row
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
--
-- The employee needs an "Approved by <approver>" stamp on the invoice-ready
-- PDF they download. The approver is usually in a DIFFERENT org (e.g. WSP
-- approving a uably employee's time), and org-scoped profiles RLS hides that
-- profile from the employee — so a join can't surface the email. Denormalize
-- it onto the approval at decision time; the employee can read approvals for
-- their own timesheets, so this is always visible to them.
-- ============================================================

alter table approvals add column if not exists decided_by_email text;
