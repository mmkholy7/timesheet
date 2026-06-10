# Approval workflow — setup

The in-app workflow (submit → manager Approvals screen → approve, with timestamp +
PDF) works as soon as a manager is linked. **Emails** require Resend + deploying the
two edge functions.

## 1. Link your WSP manager (required for the workflow)
1. Add/invite the boss: Supabase → **Authentication → Users → Add user / Invite**
   (use their real Google/Microsoft email). Or have them sign in once.
2. Edit and run [`supabase/link_approver.sql`](supabase/link_approver.sql) in the SQL Editor
   (set the boss's email). This makes them a `manager` and links them to your WSP time.
3. They sign in → they’ll see the **Approvals** tab (employees don’t).

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
```

## 5. Test end to end
1. As **you** (employee): Timesheet → enter hours on a WSP project → **Submit Week**.
   → status `Submitted`, an approval row is created, the boss gets an email.
2. As the **boss**: open the app → **Approvals** → review your WSP entries → **Approve**.
   → approval is timestamped; you + the boss get a confirmation email with the
   timestamped **PDF** attached.

> Until the functions are deployed, the in-app flow still works — emails simply no-op
> (the app shows "Email service not connected yet").
