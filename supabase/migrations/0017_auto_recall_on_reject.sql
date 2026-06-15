-- When any approval for a timesheet is rejected, automatically return the
-- timesheet to Draft so the employee can edit and resubmit without a manual
-- recall step. SECURITY DEFINER is required because the approver's JWT does
-- not have UPDATE permission on timesheets rows owned by another user.
CREATE OR REPLACE FUNCTION auto_recall_on_reject()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Rejected' AND (OLD.status IS DISTINCT FROM 'Rejected') THEN
    UPDATE timesheets SET status = 'Draft' WHERE id = NEW.timesheet_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_recall_on_reject
  AFTER UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION auto_recall_on_reject();
