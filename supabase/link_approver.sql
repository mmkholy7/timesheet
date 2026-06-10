-- Link an approver to an employee for a specific PROJECT.
-- Easiest path is the Admin screen (it auto-invites unknown approvers). Use this
-- only if you'd rather wire it up by hand in the Supabase SQL Editor.
--
-- Test scenario: mmkholy@gmail.com approves melkhouly@uably.com's WSP projects.
-- Run AFTER the approver exists (invite via Authentication → Users, or have them
-- sign in once). Auth stores emails lowercased.

-- 1) Promote the approver to a manager role
update profiles
  set role = 'manager'
  where lower(email) = lower('mmkholy@gmail.com')
    and role <> 'admin';

-- 2) Link them as approver for EACH of the employee's projects.
--    (Drop the customer filter, or narrow to one project code, as you like.)
insert into approver_links (manager_id, employee_id, project_id)
select m.id, e.id, p.id
from profiles m, profiles e, projects p
join customers c on c.id = p.customer_id
where lower(m.email) = lower('mmkholy@gmail.com')
  and lower(e.email) = lower('melkhouly@uably.com')
  and c.name = 'WSP'
on conflict (manager_id, employee_id, project_id) do nothing;

-- Verify
select e.email as employee, p.code as project, m.email as approver
from approver_links l
join profiles m on m.id = l.manager_id
join profiles e on e.id = l.employee_id
join projects p on p.id = l.project_id
order by employee, project;
