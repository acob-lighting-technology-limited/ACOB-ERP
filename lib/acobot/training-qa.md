# ACOBot — 300 Q&A Training Reference

This document contains 300 representative question-and-answer pairs covering every
major area of the ACOB ERP platform. It is used to help ACOBot provide accurate,
consistent guidance to staff.

---

## 1. General / Navigation

**Q: What is ACOBot?**
A: ACOBot is your internal assistant inside the ACOB ERP. I can help you find the right module, explain how workflows work, and answer questions about your own records (leave, attendance, tasks, assets, and more).

**Q: What can you help me with?**
A: I can explain how to use any ERP module, answer questions about your personal records (leave balance, tasks, tickets, attendance, assets, profile), look up a colleague's contact details, and guide you to the right page for any task.

**Q: Where is the Dashboard?**
A: The Dashboard is at [/](/). It shows a summary of your tasks, leave, attendance, and recent activity.

**Q: How do I navigate to a module?**
A: Use the sidebar on the left. Click any module name (Leave, Attendance, Tasks, Help Desk, Assets, etc.) to open it. The sidebar collapses on mobile — tap the menu icon to expand it.

**Q: What is the difference between the admin dashboard and the staff workspace?**
A: The staff workspace (`/`) is your personal view — your leave, your tasks, your records. The admin dashboard (`/admin`) is for HR admins and managers and shows org-wide data across all employees. The department console (`/dept/...`) is a scoped lead view limited to your department.

**Q: I can't find a page — where do I look?**
A: Try the sidebar. If the page isn't there, you may not have permission to access it. Contact an admin if you think you should have access.

**Q: How do I search for something on a data table page?**
A: Every table page has a search box at the top of the table. Type any keyword (name, status, reference number) and results filter live with a 300ms debounce.

**Q: What is the filter bar on a table page?**
A: The filter bar below the search box has dropdown menus for common filters (e.g. Department, Status, Date range). You can apply multiple filters at once. Active filters appear as pills — click × on a pill or "Clear all" to remove them.

**Q: Can I export data from a table page?**
A: Yes. Every table page has an "Export" button in the top-right action area. Click it, choose your format (CSV or PDF where available), and the file will download.

**Q: What are the Stats cards at the top of admin pages?**
A: Stats cards give a quick summary — total count, a key status count, a period metric, and a percentage. They update when you change filters.

---

## 2. Profile

**Q: How do I edit my profile?**
A: Go to [Profile](/profile) and click the "Edit" button in the top-right corner of your profile card.

**Q: What information is on my profile?**
A: Your profile shows your full name, designation (job title), department, role, email, phone, office location, join date, tenure, and (in Additional Details) secondary email, secondary phone, birthday, and residential address.

**Q: How do I update my phone number?**
A: Go to [Profile](/profile) → click "Edit" → update your phone number in the edit dialog → save.

**Q: How do I update my email address?**
A: Contact an admin to update your company email address. You can update your secondary email from [Profile](/profile) → Edit.

**Q: Where do I see my birthday on my profile?**
A: If your birthday is on file, it appears in the "Additional Details" section on your [Profile](/profile) page.

**Q: How do I see my join date?**
A: Your join date (when you joined ACOB) is shown on your profile card alongside your tenure.

**Q: What is my designation?**
A: Your designation is your job title (e.g. "Graduate Trainee", "Senior Engineer"). It's shown on your [Profile](/profile) page under your name.

**Q: What is the difference between "designation" and "role"?**
A: Designation is your job title (e.g. "Graduate Trainee"). Role is your system access level (e.g. "employee", "admin", "super_admin"). They are separate and independent.

**Q: How do I change my password?**
A: Go to [Settings](/settings) → Security / Password section.

**Q: How do I update my profile photo?**
A: Profile photos are not currently supported in the ERP. Your initials are used as your avatar.

---

## 3. Email Signature Generator

**Q: How do I generate my email signature?**
A: Go to [Signature Generator](/tools/signature) or [Tools → Signature](/tools). Fill in your name, designation, department, phone number, and other details, then click "Generate". Copy the result and paste it into your email client's signature settings.

**Q: Where is the signature tool?**
A: At [/tools/signature](/tools/signature) or via [Tools](/tools) in the sidebar.

**Q: What information do I need to generate my signature?**
A: Full name, designation (job title), department, direct phone number, and optionally your office location and work email. Pull these from your [Profile](/profile) if needed.

**Q: Can I customise the signature format?**
A: The signature follows the standard ACOB template. Contact an admin if you need a special format.

---

## 4. Leave

**Q: How do I apply for leave?**
A: Go to [Leave](/leave) → click "Apply for Leave" → fill in the leave type, start date, end date, and reason → submit. Your line manager will receive an approval request.

**Q: What is my leave balance?**
A: Ask me "what is my leave balance?" and I'll pull it from the live data. Or go to [Leave](/leave) → "Leave Balances" tab to see all your balances for the current year.

**Q: Why was my leave rejected?**
A: Go to [Leave](/leave) and find the request — the reject reason (if provided by your approver) is shown on the request details. Contact your line manager for more information.

**Q: How long does it take for leave to be approved?**
A: Approval time depends on your line manager. Check [Leave](/leave) → "My Requests" tab for the current status of your request.

**Q: Can I cancel a leave request?**
A: You can cancel a pending request from [Leave](/leave). Approved leave that has already started cannot be cancelled — contact HR.

**Q: How many leave days do I have left?**
A: Ask me "how many leave days do I have left?" or go to [Leave](/leave) → "Leave Balances" tab. I can read your balance directly when asked.

**Q: What leave types are available?**
A: Common types include Annual Leave, Sick Leave, Maternity/Paternity Leave, Compassionate Leave, Study Leave, and Unpaid Leave. Your organisation may have additional types — check [Leave](/leave) for the full list.

**Q: What is carry-forward leave?**
A: Leave days from the previous year that were not used and were approved to roll over into the current year. They appear in your balance under "Carry Forward".

**Q: I'm an approver — how do I approve leave requests?**
A: Go to [Leave](/leave) → "Approval Queue" tab. You'll see all requests awaiting your action. Click a request to view details, then click "Approve" or "Reject" (add a reason when rejecting).

**Q: Can I see my full leave history?**
A: Yes — go to [Leave](/leave) → "My Requests" tab. All past requests are listed with their status and dates.

**Q: How do I apply for sick leave?**
A: Go to [Leave](/leave) → "Apply for Leave" → select "Sick Leave" as the type → enter the dates → submit. Attach a medical certificate if required by policy.

**Q: What happens to my leave balance when I return from leave?**
A: Your used days are deducted once the leave is approved and the dates pass. Your remaining balance updates automatically.

---

## 5. Attendance

**Q: How do I clock in?**
A: Clocking in is done via the mobile app or the attendance kiosk. The ERP portal shows your records but does not have a manual clock-in button for employees.

**Q: How do I check my attendance record?**
A: Go to [Attendance](/attendance) to see your clock-in/out times, lateness flags, and monthly summary.

**Q: Was I late today?**
A: Ask me "was I late today?" and I'll check your attendance record. Or go to [Attendance](/attendance) and look for today's entry.

**Q: What does "Out of Station" (OOS) mean?**
A: OOS means you were officially away on field duty or an approved off-site assignment. It counts as an approved absence and does not penalise your attendance score.

**Q: What is "Absent with Permission" (AWP)?**
A: AWP means you were absent but your absence was officially approved in advance. It does not count as unauthorised absence.

**Q: What is "Lateness with Permission" (LWP)?**
A: LWP means you arrived late but the lateness was pre-approved. It is flagged separately from regular lateness.

**Q: What is a waiver in attendance?**
A: A waiver removes the deduction for an absent or late day. HR admins or leads apply waivers for approved reasons. Waived days appear in your attendance summary under "Waived".

**Q: My clock-in time is wrong — what do I do?**
A: Contact your admin or HR. They can manually correct the record via the Attendance Manager (admin side) with a mandatory comment explaining the change.

**Q: What is an attendance exemption?**
A: An exempted employee's attendance is not tracked for the specified period (permanent, specific weeks, months, or a date range). Exemptions are set by HR admins.

**Q: How is my attendance score calculated?**
A: The score is: (Present + AWP + OOS + On Leave days) ÷ Total Workdays × 100%. Waived days are tracked separately and shown in the summary. Late days may be weighted differently depending on your organisation's policy.

**Q: What does "half day" mean in attendance?**
A: Half-day attendance is not currently tracked in the system. Records are full-day (present, absent, OOS, AWP, etc.).

**Q: Can I see last month's attendance?**
A: Yes — go to [Attendance](/attendance) and use the month selector to switch to a previous month.

---

## 6. Tasks

**Q: How do I see my tasks?**
A: Go to [Tasks](/tasks) to see all tasks assigned to you — individual, group, and department tasks.

**Q: How do I mark a task as complete?**
A: Go to [Tasks](/tasks), open the task, and click "Mark as Complete" (or change the status to "Completed").

**Q: How do I post an update on a task?**
A: Open the task from [Tasks](/tasks) and use the "Post Update" / "Add Comment" area at the bottom.

**Q: What are my overdue tasks?**
A: Ask me "what are my overdue tasks?" and I'll pull the list. Or go to [Tasks](/tasks) and filter by "Overdue" or look for tasks with a red due date.

**Q: How are tasks assigned to me?**
A: Tasks can be assigned to you directly (individual), as part of a group of people (multiple), or to your entire department. All three types appear in your [Tasks](/tasks) page.

**Q: Can I see tasks assigned by me?**
A: From [Tasks](/tasks) there is a tab or filter for tasks you created or assigned. Check the tab options on the page.

**Q: What task statuses are there?**
A: Common statuses: Pending, In Progress, Completed, Cancelled, On Hold. The exact statuses depend on your organisation's configuration.

**Q: Can I create a task?**
A: Yes — from [Tasks](/tasks), click "Add Task" (or "Create Task"). You can assign it to a person, multiple people, or a department.

**Q: I can't find a task that was assigned to me — what do I do?**
A: Check [Tasks](/tasks) and use the search or filter for "All Statuses" to include completed and cancelled tasks. If it still doesn't appear, it may have been reassigned — contact the task creator.

---

## 7. Help Desk

**Q: How do I raise a support ticket?**
A: Go to [Help Desk](/help-desk) → click "Raise Ticket" → fill in the title, category, description, and priority → submit.

**Q: How do I track my ticket?**
A: Go to [Help Desk](/help-desk) → find your ticket in the list. Click it to see the full details, comments, and current status.

**Q: What ticket statuses are there?**
A: New → In Progress → Resolved → Closed. An SLA timer tracks how long the ticket has been open.

**Q: Why is my ticket still open?**
A: Contact the assigned agent or your IT/admin team. You can add a comment on the ticket from [Help Desk](/help-desk) to follow up.

**Q: How do I add a comment to my ticket?**
A: Open the ticket from [Help Desk](/help-desk) and use the comment box at the bottom.

**Q: Can I reopen a closed ticket?**
A: Contact your IT/admin team. Closed tickets cannot be reopened directly by employees from the portal.

**Q: How do I know if my ticket has been assigned?**
A: Open the ticket from [Help Desk](/help-desk) — the "Assigned To" field shows the agent handling your request.

**Q: My ticket is overdue — what do I do?**
A: Add a follow-up comment on the ticket and contact the assigned agent or your IT/admin team directly.

---

## 8. Assets

**Q: What assets are assigned to me?**
A: Ask me "what assets do I have?" or go to [Assets](/assets) to see your current equipment.

**Q: I've been assigned a new laptop — where do I see it?**
A: Once assigned in the system, it will appear on your [Assets](/assets) page.

**Q: How do I report a damaged or lost asset?**
A: Contact your admin or use [Help Desk](/help-desk) to raise a ticket. You can also flag it on your [Assets](/assets) page if there is a "Report Issue" option.

**Q: Who do I contact if my asset assignment is wrong?**
A: Contact your HR admin or IT team. They can correct it via the admin Assets module at [/admin/assets](/admin/assets).

**Q: What is the difference between "individual", "department", and "office" asset assignment?**
A: Individual = assigned to a specific person. Department = available to all staff in a department. Office = available to everyone in a specific office location.

---

## 9. Payments

**Q: How do I view my payslip?**
A: Go to [Payments](/payments) to see your payment records and payslips.

**Q: When will I receive my salary?**
A: Contact your HR/Finance team. Payment schedules are determined by management and are not set within the ERP.

**Q: What payment types are there?**
A: Common types include Salary, Allowance, Bonus, Reimbursement, and Loan. The types available depend on your organisation's configuration.

**Q: I see a payment I don't recognise — what do I do?**
A: Go to [Payments](/payments) to view its details, then contact your HR/Finance team to query it.

---

## 10. Correspondence

**Q: How do I view official letters sent to me?**
A: Go to [Correspondence](/correspondence) to see all incoming and outgoing letters and memos related to you.

**Q: What is the correspondence module?**
A: It tracks official company letters, memos, and notices — both incoming (received) and outgoing (sent). Each item has a reference number, status, and a full action history.

**Q: What do the correspondence status badges mean?**
A: Draft = not yet sent; Sent = dispatched; Received = delivered to recipient; Acknowledged = recipient has acknowledged receipt; Action Required = requires a response; Closed = resolved/no further action.

**Q: What happens when I acknowledge a correspondence item?**
A: Acknowledging confirms you have read it. The sender and relevant admins are notified. The status updates to "Acknowledged".

---

## 11. Directory

**Q: How do I find a colleague's email address?**
A: Ask me "what is [Name]'s email?" or go to [Directory](/directory) and search for their name.

**Q: Who is the head of the ICT department?**
A: Ask me "who leads the ICT department?" and I'll check the directory. Or go to [Directory](/directory) and filter by department.

**Q: How do I find someone's phone number?**
A: Ask me "what is [Name]'s phone number?" or search for them on [Directory](/directory).

**Q: Is the directory available to all staff?**
A: Yes — contact details (name, email, phone, department, office, and department lead status) are shared org-wide and available to all active staff.

**Q: I can't find a colleague in the directory — what does that mean?**
A: They may have exited the organisation (exited employees are excluded from the directory) or their profile may be incomplete. Contact HR if you need their details.

**Q: How do I find out who leads my department?**
A: Ask me "who leads the [department name] department?" or go to [Directory](/directory) and filter/search for department leads.

---

## 12. Notifications

**Q: Where are my notifications?**
A: Go to [Notifications](/notifications) — the bell icon in the top bar also shows your unread count.

**Q: What kinds of notifications do I get?**
A: Approvals (leave, correspondence), task updates, asset alerts and transfers, mentions, meeting reminders, announcements, and system alerts.

**Q: I got a notification about an asset — where do I manage my assets?**
A: Go to [Assets](/assets). Notifications just alert you; asset management is under [Assets](/assets), not [Notifications](/notifications).

**Q: How do I mark notifications as read?**
A: Open [Notifications](/notifications) and click "Mark all as read" or click an individual notification to mark it as read.

**Q: Can I filter notifications by category?**
A: Yes — [Notifications](/notifications) has tabs for Approvals, Tasks, Assets, Feedback, Mentions, and All.

---

## 13. PMS (Performance Management)

**Q: Where are my KPI targets?**
A: Go to [PMS](/pms) → "KPI" tab to see your targets for the current cycle.

**Q: What is the PMS cycle?**
A: The Performance Management System (PMS) cycle is typically quarterly or annual. Your org's HR team sets the cycle dates.

**Q: How do I submit my self-assessment?**
A: Go to [PMS](/pms) → "Behaviour" tab and complete the self-assessment form for each competency.

**Q: What is peer feedback in PMS?**
A: Peer feedback is 360° feedback from colleagues. You can receive and give it via [PMS](/pms) → "Peer Feedback" tab.

**Q: Where do I see my final performance rating?**
A: Once calibration is complete and results are published, they appear under [PMS](/pms) or [Reviews](/reviews).

---

## 14. KSS (Knowledge Sharing Sessions) — Admin

**Q: How do I schedule a KSS?**
A: Go to [Admin → KSS](/admin/kss) → "Manage Weeks" → set the presenter type, department, and presenter name for the week.

**Q: Why didn't the presenter's name and department appear in the KSS reminder email?**
A: This happens when the session is set to "Recurring" but the presenter details weren't saved for that specific week — the system used the template rather than the week's settings. Make sure you are **adding** a new week entry, not editing an existing one from a past week.

**Q: How do I override the KSS grace period?**
A: On the KSS management page, when you attempt to override the grace period, a confirmation dialog appears asking you to confirm the override. This is a safety check. Confirm to proceed.

**Q: How do I mark KSS attendance?**
A: Go to [Admin → KSS](/admin/kss), find the session, and open the attendance panel. Mark each attendee as Present, Late, or Absent.

**Q: How do I export KSS records?**
A: From [Admin → KSS](/admin/kss), click the Export button in the top-right area.

**Q: Can I set KSS to recurring?**
A: Yes — when adding a week, toggle "Recurring" to have the session automatically repeat. Ensure presenter details are set for each week if they vary.

---

## 15. Attendance Management (Admin)

**Q: How do I access the Attendance Manager?**
A: Go to [Admin → Attendance](/admin/hr/attendance) or the Department Console Attendance page, and click the "Attendance Manager" button in the top-right area.

**Q: What tabs are in the Attendance Manager?**
A: The Attendance Manager has 5 tabs:
- **Exemption** — apply/remove attendance tracking exemptions for one or more employees.
- **Holiday** — add or remove public holidays for a month (single date or date range).
- **OOS** — bulk-mark employees as Out of Station for a date range.
- **Waiver** — apply an attendance waiver for a date range.
- **Leave** — manually add approved leave without going through the normal leave request flow.

**Q: How do I exempt an employee from attendance tracking?**
A: Attendance Manager → Exemption tab → select the employee(s) → choose the mode (Permanent, Specific Weeks, Specific Months, or Custom Date Range) → click "Apply Exemption".

**Q: How do I remove an exemption?**
A: Attendance Manager → Exemption tab → select the employee(s) → choose mode "Disabled (remove exemption)" → click "Remove Exemption".

**Q: How do I add a public holiday?**
A: Attendance Manager → Holiday tab → enter the date and name → click "Add Holiday". For multiple days, toggle "Date range" and set a start and end date.

**Q: How do I mark employees as OOS (Out of Station)?**
A: Attendance Manager → OOS tab → select employees → set start/end date → add a comment (required) → click "Apply OOS".

**Q: How do I apply a waiver for an employee?**
A: Attendance Manager → Waiver tab → select employees → set date range → enter the waiver reason (required) → click "Apply Waiver".

**Q: How do I manually add leave to an employee's attendance?**
A: Attendance Manager → Leave tab → select employees → choose leave type → set start/end date → add a comment (required) → click "Add Leave Record". This bypasses the normal leave request flow.

**Q: A comment is required — why?**
A: Every manual attendance change (OOS, waiver, leave, individual record edit) requires a comment for audit purposes. This is enforced by the system.

**Q: How do I edit an individual attendance record?**
A: On the [Attendance](/admin/hr/attendance) report table, click the expand arrow on an employee row → find the day → click the Edit icon → update status, clock-in/out time, waiver, and comment → save.

**Q: Can I generate a quarterly attendance report?**
A: Yes — on [Admin → Attendance](/admin/hr/attendance), switch from "Monthly" to "Quarterly" using the period selector, then click "Generate Report".

---

## 16. Leave Management (Admin)

**Q: How do I approve a leave request?**
A: Go to [Admin → Leave](/admin/hr/leave) → "Approval Queue" tab → click the request → click "Approve".

**Q: How do I reject a leave request?**
A: Go to [Admin → Leave](/admin/hr/leave) → "Approval Queue" tab → click the request → click "Reject" → enter a reason.

**Q: How do I view all leave requests?**
A: Go to [Admin → Leave](/admin/hr/leave) → "All Requests" tab. Filter by status, department, or date range.

**Q: How do I view an employee's leave balance?**
A: Go to [Admin → Leave](/admin/hr/leave) → "Leave Balances" tab → search for the employee.

**Q: How do I configure leave types?**
A: Go to [Admin → Leave](/admin/hr/leave) → "Leave Types" tab → add or edit leave categories and default allocations.

**Q: How do I manually add a leave record for an employee?**
A: Use the Attendance Manager → Leave tab on the [Attendance](/admin/hr/attendance) page. This creates an approved leave record directly without the employee submitting a request.

**Q: What is the leave approval flow?**
A: Employee submits → first approver (line manager / HOD) reviews → second approver (if configured) → HR final approval. The number of approval stages depends on your organisation's configuration.

---

## 17. Employee Management (Admin)

**Q: How do I add a new employee?**
A: Go to [Admin → Employees](/admin/hr/employees) → click "Add Employee" → fill in the employee details → save.

**Q: How do I update an employee's department?**
A: Go to [Admin → Employees](/admin/hr/employees) → find the employee → expand their row or click edit → update the department.

**Q: How do I suspend an employee?**
A: Go to [Admin → Employees](/admin/hr/employees) → find the employee → use the "Change Status" option → select "Suspended".

**Q: How do I process an exit for an employee?**
A: Go to [Admin → Exit Management](/admin/hr/exit) → initiate an exit request for the employee, or go to [Admin → Employees](/admin/hr/employees) → change the employee's status to "Exited".

**Q: What employment statuses are there?**
A: Active, Suspended, Exited. Exited employees are excluded from the staff directory and presenter lists.

**Q: How do I search for a specific employee?**
A: Go to [Admin → Employees](/admin/hr/employees) → use the search box (name, email, or employee number) or the department/status filter dropdowns.

---

## 18. Assets Management (Admin)

**Q: How do I assign an asset to an employee?**
A: Go to [Admin → Assets](/admin/assets) → find the asset → click "Assign" → select "Individual" → choose the employee → save.

**Q: How do I assign an asset to a department?**
A: Go to [Admin → Assets](/admin/assets) → find the asset → click "Assign" → select "Department" → choose the department → save.

**Q: How do I transfer an asset?**
A: Go to [Admin → Assets](/admin/assets) → find the asset → click "Transfer" → select the new assignee type and name → save.

**Q: How do I return an asset?**
A: Go to [Admin → Assets](/admin/assets) → find the asset → click "Return" → confirm. The asset status changes to "Available".

**Q: What does the "Assigned To" column show?**
A: For individual assignments: the employee's name. For department assignments: the department name. For office assignments: the office location name.

**Q: How do I add a new asset?**
A: Go to [Admin → Assets](/admin/assets) → click "Add Asset" → fill in the asset type, model, serial number, and other details → save.

**Q: How do I filter assets by department?**
A: Go to [Admin → Assets](/admin/assets) → use the "Department" filter dropdown in the filter bar.

---

## 19. Reference Generator (Admin)

**Q: How do I generate a reference letter?**
A: Go to [Admin → Reference Generator](/admin/tools/reference-generator) or [Tools → Reference Generator](/tools/reference-generator) → click "New Reference" → fill in the details → generate.

**Q: Where are reference letters stored?**
A: All generated references are tracked in the Reference Generator module with their unique reference codes and status.

**Q: What is the format of a reference code?**
A: Reference codes follow the ACOB standard format (e.g. ACOB/REF/YYYY/NNNNN). The system generates them automatically.

---

## 20. General Meetings (Admin)

**Q: How do I schedule a general meeting?**
A: Go to [Admin → Meetings](/admin/meetings) → click "Add Meeting" → set the title, date, time, meeting type (all-staff or department), and add presenters → save.

**Q: Why is a presenter missing from the presenter selection list?**
A: The presenter list excludes exited employees automatically. If a staff member who is still active is missing, check that their employment status is "Active" in [Admin → Employees](/admin/hr/employees).

**Q: How do I mark attendance for a meeting?**
A: Go to [Admin → Meetings](/admin/meetings) → open the meeting → use the attendance panel to mark each attendee as Present, Late, or Absent.

**Q: How do I send a reminder for a meeting?**
A: Meeting reminder emails are sent automatically before the meeting (schedule set by the system). If you need to resend, contact your admin.

---

## 21. Correspondence Management (Admin)

**Q: How do I add a new correspondence item?**
A: Go to [Admin → Correspondence](/admin/correspondence) → click "Add Correspondence" → fill in the reference number, subject, type, and parties → save.

**Q: How do I approve or acknowledge a correspondence item?**
A: Open the correspondence item from [Admin → Correspondence](/admin/correspondence) → use the "Action" buttons to acknowledge, escalate, or close it.

**Q: How do I export correspondence records?**
A: Go to [Admin → Correspondence](/admin/correspondence) → click the "Export" button → choose your format → download.

**Q: What badge colours do correspondence status labels use?**
A: Draft (grey), Sent (blue), Received (teal), Acknowledged (green), Action Required (amber), Closed (muted).

---

## 22. Help Desk Management (Admin)

**Q: How do I view all open tickets?**
A: Go to [Admin → Help Desk](/admin/help-desk) → filter by status "Open" or use the "Open Tickets" tab.

**Q: How do I assign a ticket to an agent?**
A: Open the ticket from [Admin → Help Desk](/admin/help-desk) → click "Assign" → select the agent from the dropdown → save.

**Q: How do I close a ticket?**
A: Open the ticket → click "Close" → optionally add a resolution note.

**Q: How do I filter tickets by department?**
A: Go to [Admin → Help Desk](/admin/help-desk) → use the Department filter dropdown.

**Q: What is SLA in the Help Desk?**
A: SLA (Service Level Agreement) is the target time to respond and resolve a ticket. Overdue tickets (past their SLA deadline) are flagged in red.

---

## 23. Department Console (Department Leads)

**Q: What is the department console?**
A: The department console is a scoped lead view at `/dept/[dept_id]/...`. Every page — stats, records, filters, exports, and sub-tabs — shows **only your department's data**.

**Q: How do I access the department console?**
A: If you are a department lead, the department console link appears in your sidebar. Click it to open your scoped view.

**Q: Why do I see empty results in the department console?**
A: If results are empty, it means there is no data for your department in that period — they do not fall back to org-wide data. The console is strictly locked to your team.

**Q: Can I see other departments' data from the department console?**
A: No. The department console is locked to your department. For org-wide data, you need admin access.

**Q: As a department lead, can I approve leave?**
A: Yes — if you are in the approval chain, go to [Leave](/leave) → "Approval Queue" tab, or the Leave section in your Department Console, to approve or reject requests from your team.

**Q: As a department lead, how do I see my team's attendance?**
A: Go to your Department Console → Attendance section. All records and reports are scoped to your department automatically.

---

## 24. Permissions & Access

**Q: I don't have access to a page — what do I do?**
A: Contact your admin. Access is controlled by your role (employee, department lead, admin, super admin). You need to be assigned the appropriate role to access restricted pages.

**Q: What roles exist in the ERP?**
A: Employee (default), Department Lead (scoped lead view + approval rights), Admin (full admin dashboard), Super Admin (system settings + all admin access).

**Q: Who can access the admin dashboard?**
A: Users with the "admin" or "super_admin" role. Employees and department leads do not have access to `/admin/...`.

**Q: What can a super admin do that a regular admin cannot?**
A: Super admins can access [Settings](/admin/settings) for role management, user administration, and system configuration. Regular admins cannot access Settings.

---

## 25. System & Technical

**Q: The ERP is slow — what do I do?**
A: Try refreshing the page. If the issue persists, raise a ticket on [Help Desk](/help-desk) for the IT team.

**Q: I got an error on a page — what do I do?**
A: Note the error message and raise a ticket on [Help Desk](/help-desk) with a description of what you were doing and the error you saw.

**Q: How do I log out?**
A: Click your profile avatar or initials in the top-right corner → click "Sign Out" or "Log Out".

**Q: Is the ERP available on mobile?**
A: Yes — the ERP is responsive and works on mobile browsers. Some features (e.g. clock-in) may use the dedicated mobile app.

**Q: My session expired — how do I get back in?**
A: Your session timed out for security. Log in again with your credentials at the login page.

**Q: How do I switch between light mode and dark mode?**
A: Use the theme toggle in the top navigation bar (sun/moon icon or Settings menu).

**Q: Who do I contact for technical issues?**
A: Raise a ticket on [Help Desk](/help-desk) for IT issues, or contact the system administrator directly.

---

## 26. Data & Privacy

**Q: Who can see my personal data?**
A: Your own data (leave, attendance, tasks, payslips, personal profile details) is visible to you, your HR admin, and your line manager (within their approval scope). Contact details (name, email, phone, department, office) are visible to all staff via the Directory.

**Q: Can I see a colleague's leave or pay details?**
A: No. Sensitive personal data (leave, attendance, pay, date of birth) is self-only. Only HR admins and scoped managers can access team records within their authorised scope.

**Q: Is my data secure?**
A: Yes. All data is protected by authentication, role-based access control (RBAC), and row-level security in the database. Every manual data change is logged in an audit trail.

---

## 27. Audit & Compliance

**Q: Are manual attendance changes logged?**
A: Yes. Every manual change to an attendance record (edit, OOS, waiver, leave) is logged with the actor's ID, the reason, and a timestamp. A comment is required for all changes.

**Q: How do I view the audit log for a record?**
A: On some records (e.g. attendance), click the "History" icon on an individual entry to see the full edit history with timestamps and reasons.

**Q: Who can see audit logs?**
A: Audit logs are accessible to admins and super admins only.

---

## 28. Miscellaneous

**Q: What is CBT?**
A: CBT (Computer-Based Training) at [/cbt](/cbt) provides assessments and training modules for staff development.

**Q: What is the Fleet module?**
A: [Fleet](/fleet) tracks company vehicles — assignments, usage logs, and maintenance records.

**Q: What is Documentation?**
A: [Documentation](/documentation) is a library of company policies, procedures, and reference documents.

**Q: What are the Reports in the ERP?**
A: [Reports](/reports) includes KSS reports (knowledge sharing session summaries), the Action Tracker (follow-ups from meetings), and weekly staff reports.

**Q: What does "Goals" mean in the ERP?**
A: [Goals](/goals) lets you set and track personal or team objectives, linked to your PMS performance cycle.

**Q: What is the Purchasing module?**
A: [Admin → Purchasing](/admin/purchasing) manages purchase orders, vendor approvals, and procurement workflows for the organisation.

**Q: What is the Inventory module?**
A: [Admin → Inventory](/admin/inventory) tracks stock levels, consumables, and supply management for the organisation.

**Q: What is the Finance module?**
A: [Admin → Finance](/admin/finance) provides org-wide financial records, budgets, and reports. Access is restricted to authorised finance staff.

**Q: I have a question about a feature that ACOBot doesn't know about — what do I do?**
A: Raise a ticket on [Help Desk](/help-desk) and describe the feature question. The IT or HR team will help.

**Q: How do I give feedback on ACOBot?**
A: Use [Help Desk](/help-desk) to submit feedback on the assistant, or contact the system administrator.
