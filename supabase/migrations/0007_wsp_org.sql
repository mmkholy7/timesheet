-- ============================================================
-- Timesheet — Create WSP organization + link WSP approver accounts
-- Apply in Supabase: SQL Editor → paste → Run. Safe to re-run.
--
-- WSP is a client whose projects uably employees log time against.
-- Mohamed.moheyel@wsp.com and Richard.baughman@wsp.com are WSP-side
-- approvers; they get the WSP org so they see WSP branding after login.
-- ============================================================

insert into organizations (name, slug, logo_url)
values ('WSP', 'wsp', '/wsp-logo.svg')
on conflict (slug) do update
  set name     = excluded.name,
      logo_url = excluded.logo_url;

-- Link the two WSP approver accounts to the WSP org.
update profiles
set organization_id = (select id from organizations where slug = 'wsp')
where lower(email) in ('mohamed.moheyel@wsp.com', 'richard.baughman@wsp.com')
  and (organization_id is null
       or organization_id <> (select id from organizations where slug = 'wsp'));
