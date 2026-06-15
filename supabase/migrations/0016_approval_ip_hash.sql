-- Persist the SHA-256 hash of (approver IP | decided_at) so the value shown
-- on the PDF can be reproduced / verified against the audit_log entry.
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS ip_hash text;
