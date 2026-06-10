-- Link a manager (your WSP boss) to an employee for a customer.
-- Run AFTER the manager exists in the system (invited via Authentication → Users,
-- or after they have signed in once with Google/Microsoft).
--
-- Edit the two emails below, then run in the Supabase SQL Editor.

-- 1) Promote the boss to a manager role
update profiles
  set role = 'manager'
  where lower(email) = lower('BOSS_EMAIL_HERE@wsp.com');

-- 2) Allow that manager to approve YOUR WSP timesheets
insert into approver_links (manager_id, employee_id, customer_id)
select m.id, e.id, c.id
from profiles m, profiles e, customers c
where lower(m.email) = lower('BOSS_EMAIL_HERE@wsp.com')
  and lower(e.email) = lower('melkhouly@uably.com')
  and c.name = 'WSP'
on conflict (manager_id, employee_id, customer_id) do nothing;

-- Verify
select m.email as manager, e.email as employee, c.name as customer
from approver_links l
join profiles m on m.id = l.manager_id
join profiles e on e.id = l.employee_id
join customers c on c.id = l.customer_id;
