# STRATEGIC PROPOSAL: Ticketing & Performance Tracking System

**Prepared by**: Chibuikem Ilonze  
**Presented for**: Corporate Services Approval  
**February 15, 2026**

---

## 0. Business Context & Problem Statement

### Current Operational Challenges

As ACOB Lighting Technology Limited continues to grow, internal support requests across departments are increasing in volume and complexity. The current informal processes present several strategic risks:

- **Lack of Centralized Tracking**: Internal support requests are fragmented across multiple channels (WhatsApp, emails, verbal), making oversight difficult.
- **Limited Visibility**: Management has minimal data on departmental workloads or response efficiency.
- **Accountability Gaps**: Inconsistent follow-up on internal issues reduces operational momentum.
- **Informal Procurement Flows**: Non-standardized approval paths for purchases cause unnecessary delays.
- **Absence of Performance Data**: No measurable indicators exist to support data-driven performance reviews.

### Strategic Objective

The objective of this initiative is to implement a structured, measurable, and accountable internal service management system that aligns operational efficiency with executive oversight and professional governance.

---

## 1. Business & Strategic Benefits

### Executive Visibility & Control

- **Real-Time Dashboards**: Instant oversight of departmental workloads and operational bottlenecks.
- **Transparent Governance**: A digital, tamper-proof audit trail for all procurement-related requests.
- **Unified Reporting**: Centralized data for management oversight and strategic planning.

### Performance-Driven Culture

- **Measurable Individual KPIs**: Clear performance metrics for every employee and department.
- **Data-Backed Appraisals**: Objective data to support HR performance evaluations and promotions.
- **Accountability Trail**: Systematic tracking of task ownership from request to resolution.

### Improved Operational Efficiency

- **Optimized Turnaround Times**: Reduced delays through clear prioritization and automated routing.
- **Structured Prioritization (SLA)**: Ensuring critical business failures are addressed with the highest urgency.
- **Reduced Downtime**: Proactive management of repairs and support to maintain productivity.

### Financial Governance & Budget Protection

- **Standardized Approval Workflows**: Rigid, multi-stage authorization for all financial commitments.
- **Executive Authorization**: Direct oversight by the MD and Head of Corporate Services on all procurement.
- **Risk Mitigation**: Elimination of unauthorized or undocumented internal purchases.

---

## 2. Multi-Department Support & Routing

Any department can be configured as a Service Provider. Initial implementation covers:

- **IT & Communications**: Digital infrastructure, **Design** requests, and **Capturing** services.
- **Operations**: Technical repairs, equipment maintenance, and logistics.
- **Admin & HR**: Documentation, facility management, and staff welfare.
- **Accounts**: Financial clearances and reimbursements.

### Intelligent Routing & Approval Logic

It is critical to distinguish between **Standard Support** and **Procurement Requests**:

1. **Standard Support Requests**:
   - Tickets for repairs, installations, or general queries route directly to the department queue.
   - These do **not** require high-level approval and can be actioned immediately.
   - The Department Lead is notified to assign the task to a qualified **employee**.

2. **Procurement & Purchase Requests**:
   - Tickets specifically categorized as "Procurement" are automatically flagged for executive approval.
   - These tickets are **not** actionable until the multi-stage approval chain is completed.

---

## 3. The Professional Ticket Lifecycle

### Phase 1: Submission & Assignment

- **Queueing**: Tickets enter a departmental pool (Unassigned Queue).
- **Assignment**: Leads assign tickets, or employees "Claim" them.
- **KPI Start**: The "Response Time" clock starts at submission and stops at assignment/acceptance.

### Phase 2: Execution & "Universal Pivot"

- **In Progress**: Work is carried out by the assigned employee.
- **Universal Pivot to Procurement**: If an employee realizes a repair requires a purchase (e.g., a hardware part):
  1. They trigger the **"Pivot to Procurement"** mechanism.
  2. The status changes to `Pending Approval`.
  3. The performance clock (TAT) pauses to avoid penalizing the employee for external logistics delays.
  4. The executive approval chain is automatically initiated.

### Phase 3: Resolution & CSAT

- **Validation**: Requester confirms the issue is solved.
- **Customer Satisfaction (CSAT)**: Requester provides a 1-5 star rating and feedback, impacting the employee's performance metrics.

---

## 4. Performance Framework (KPIs)

To ensure high standards of service, the system tracks:

| KPI                       | Measurement              | Professional Objective                           |
| :------------------------ | :----------------------- | :----------------------------------------------- |
| **Response Time**         | Submission -> Assignment | Minimize delay in acknowledging issues.          |
| **Turnaround Time (TAT)** | Assignment -> Resolution | Optimize operational speed and efficiency.       |
| **SLA Compliance**        | Resolution vs. Deadline  | Ensure urgent business needs are prioritized.    |
| **CSAT Score**            | User Rating (1-5 Stars)  | Ensure high quality of service and satisfaction. |

#### SLA Targets by Priority

- **Urgent**: 4 Business Hours (Critical Failures)
- **High**: 24 Business Hours (Major Disruptions)
- **Medium**: 3 Business Days (Standard Requests)
- **Low**: 7 Business Days (Long-term Improvements)

---

## 5. Governance & Approval Workflow

All procurement-related or "Pivoted" requests enforce the following professional chain:

| Step  | Level                          | Responsibility                                       |
| :---- | :----------------------------- | :--------------------------------------------------- |
| **1** | **Department Lead**            | Technical verification of necessity within the dept. |
| **2** | **Head of Corporate Services** | Budgetary alignment and corporate priority.          |
| **3** | **Managing Director (MD)**     | Final executive authorization for funds/resources.   |

---

## 6. Technical Implementation Details

### Database Architecture (Security & Audit)

The system is built on a secure architecture to ensure data integrity and accountability:

- `help_desk_tickets`: Structured storage for all requests and metadata.
- `help_desk_approvals`: Secure audit trail of every signature and decision.
- `help_desk_comments`: Integrated internal communication for employee collaboration.

### Security (Role-Based Access Control)

- **All Employees**: Can create tickets and track their own statuses.
- **Service Center Staff**: Can view and resolve tickets assigned to them within their department.
- **Leads**: Can view all departmental tickets, assign tasks, and view performance reports.
- **Executives**: Full oversight of cross-departmental dashboards and approval processing.

---

## 7. Success Measurement Criteria

The system will be considered successful if:

- **90%+ SLA Compliance** is achieved within the first quarter.
- **100% of Procurement Actions** follow the structured approval chain.
- **Departmental KPI Dashboards** are adopted as the primary basis for performance reviews.
- **Internal CSAT Average** exceeds 4.0/5.0 stars.

---

**Prepared by**: Chibuikem Ilonze  
**Presented for**: Corporate Services Approval  
**February 15, 2026**
