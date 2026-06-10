# Approval workflow — setup

Approvers are assigned **per project**. The in-app workflow (submit → manager
Approvals screen → approve, with timestamp + PDF) works as soon as an approver is
linked. **Emails** require Resend + deploying the edge functions.

Two submit actions on the Timesheet header:

- **Submit** — marks the week Submitted and creates the pending approval(s); no email.
- **Submit & Send for Approval** — same, and emails the project's approver(s).

## 0. Apply the schema migration (one-time)
Run [`supabase/migrations/0002_per_project_approvers.sql`](supabase/migrations/0002_per_project_approvers.sql)
in the SQL Editor. It moves approver links + approvals from per-customer to
per-project and lets the invite function set roles.

## 1. Link the project approver (required for the workflow)
**Easiest:** sign in as an admin → **Admin → Approvers** → pick the employee +
project, type the approver's email, **Assign**. If that email isn't a user yet it's
**invited by email automatically** (needs the `invite-approver` function deployed).

Manual alternative: invite them via Supabase → **Authentication → Users**, then edit
and run [`supabase/link_approver.sql`](supabase/link_approver.sql) in the SQL Editor.

The approver signs in → they see the **Approvals** tab (employees don't).

## 2. Resend (for emails)
1. Create an account at https://resend.com.
2. **Domains → Add Domain** → `uably.com` → add the shown **DNS records** (SPF/DKIM)
   to your DNS → wait for **Verified** (can take minutes–hours).
3. **API Keys → Create** → copy the key (starts with `re_`).

## 2b. Custom SMTP for Auth emails (stops invites going to spam)
Supabase's **default** mail service sends invite/recovery/confirmation emails from a
generic domain → they land in spam. Route them through your verified domain instead:

**Supabase → Project Settings → Authentication → SMTP Settings → enable Custom SMTP**

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) or `587` (TLS) |
| Username | `resend` |
| Password | Resend API key (`re_…`) |
| Sender email | `no-reply@uably.com` (verified domain) |
| Sender name | `Timesheet` |

Also add a **DMARC** record for deliverability:
```
_dmarc.uably.com   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@uably.com"
```
Note: `uably.com` is on Microsoft 365, so it already has an SPF record — authenticate
Resend via **DKIM** (and a `send.` subdomain return-path) so the two don't conflict.

## 2c. DMARC for the sending subdomain (`ts.uably.com`) — stops phishing flags
Auth/notification mail is sent **From** `ts@ts.uably.com`, so DMARC is checked on
`ts.uably.com`. Without a record there, receivers (e.g. Microsoft Defender) only see
`dmarc=bestguesspass` and may quarantine the mail as **High Confidence Phish** even
though SPF + DKIM pass. Publish an explicit record for the subdomain:
```
_dmarc.ts.uably.com   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@uably.com"
```

**Adding it in Cloudflare** (authoritative DNS for `uably.com`): Cloudflare auto-appends
the zone name, so enter the **Name** without the zone:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc.ts`  (Cloudflare shows it as `_dmarc.ts.uably.com`) |
| Content | `v=DMARC1; p=none; rua=mailto:dmarc@uably.com` |
| TTL | Auto |

(If the Cloudflare zone is `ts.uably.com` rather than `uably.com`, set Name = `_dmarc`.)
After it propagates, the next message header should read `dmarc=pass`.

### If mail still gets quarantined (recipient-side, Microsoft 365 / Defender)
Auth emails are phishing-shaped ("You've been invited", "Reset your password") from a
new domain → reputation heuristics, not an auth failure. On the recipient tenant:
1. **Defender → Actions & submissions → Submissions** → submit the message as
   *"Should not have been blocked"* and tick **Allow this message**.
2. **Threat policies → Tenant Allow/Block Lists → Domains & addresses → Allow** →
   add `ts.uably.com`.
3. Durable bypass: an **Exchange mail-flow rule** → *Bypass spam filtering* when sender
   domain is `ts.uably.com` **and** sender IP is in `54.240.14.0/24` (Amazon SES).

> Since real users sign in with Google/Microsoft SSO, you can largely avoid the
> invite/reset/magic-link emails: use **Admin → Users** (creates the account with no
> email) and let people sign in via SSO. Only the app's approval notifications then
> need to deliver.

## 3. Supabase secrets
Set these so the functions can send mail (Dashboard → Edge Functions → Secrets, or CLI):
```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set MAIL_FROM="Timesheet <no-reply@uably.com>"
supabase secrets set APP_URL="https://ts.uably.com"
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## 4. Deploy the edge functions
```bash
supabase link --project-ref fbhjzxficuevqevtuluh   # once
supabase functions deploy notify-submission
supabase functions deploy confirm-approval
supabase functions deploy invite-approver
supabase functions deploy admin-create-user
```

(Or deploy any of these from the Dashboard → **Edge Functions → Via Editor**: name it
exactly as above and paste the matching `supabase/functions/<name>/index.ts`. Each file
is self-contained.)

The **Admin → Users** section uses `admin-create-user` to add people straight to the
database (no invite email). **Admin → Approvers** uses `invite-approver` to assign a
project approver, inviting them by email if they aren't a user yet.

## 5. Test end to end (mmkholy@gmail.com approves melkhouly@uably.com)
1. As **admin** (melkhouly@uably.com): **Admin → Approvers** → Employee
   `melkhouly@uably.com`, Project = a WSP project, Approver `mmkholy@gmail.com` →
   **Assign**. Not a user yet → they're invited by email automatically.
2. As **melkhouly** (employee): Timesheet → enter hours on that WSP project →
   **Submit & Send for Approval**. → status `Submitted`, a per-project approval row
   is created, mmkholy gets an email. (Plain **Submit** does the same without email.)
3. As **mmkholy** (accept the invite, sign in): **Approvals** → review the WSP entries
   for that project → **Approve**. → timestamped; both parties get a confirmation
   email with the timestamped **PDF** attached.

> Until the functions are deployed, the in-app flow still works — emails simply no-op
> (the app shows "Email service not connected yet"), and unknown approvers must be
> invited manually in Supabase before assigning.
