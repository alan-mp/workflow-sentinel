# Sentinel: Product Requirements Document

Six components. Evidence: [validation.md](validation.md); tests per criterion: [spec.md](spec.md).

## 1. Problem
Every internal system (HR, ERP, product development, chat and email) has its own approval logic: people do not know
who approves, chains are long, and each reorganization is developer work repeated in every system. **Angle:** one
place for approval rules, owned by process owners, drafted by AI from the SOP, approvers computed from the organization.

## 2. Target users
| User | Job to be done |
|---|---|
| Requester | File a request and see who it waits on |
| Approver | Decide a queue quickly, often on a phone, with context |
| Process owner | Turn the SOP into a flow and change it without a developer |
| Administrator (IT) | Set up organization, owners and integrations |

## 3. Goals and success metrics
| Goal | Metric and target |
|---|---|
| Decisions on time | ≥ 90% of tasks decided within SLA |
| No ambiguous approver | 0 unresolved approvers in flows that pass the coverage test |
| Rules owned by the business | 100% of flow changes made without code |
| Traceable decisions | 100% with actor, time, flow version and reason |
| AI saves drafting time | SOP to valid draft in < 5 minutes |

## 4. Features and acceptance criteria
| # | Feature | Acceptance criteria (testable) |
|---|---|---|
| F1 | Submit and track | Valid data opens the first task; invalid data gets HTTP 400 |
| F2 | Inbox | Only own and delegated tasks, by due date; bulk approve = one decision per task |
| F3 | Separation of duties | Requester never decides own request (403); editor cannot activate own draft |
| F4 | **AI flow drafter** | SOP → valid draft, a checked quote per rule; asks when unclear; cannot activate |
| F5 | Validation, simulation | No path may end without human approval; simulation stores nothing |
| F6 | Approvers from org tree | Superior = unit head; vacancy escalates with stated reason |
| F7 | Organization changes | Second-owner approval; open tasks move to the new head, audited |
| F8 | SLA | Overdue: one reminder; 2× SLA: superior added, never the requester |
| F9 | Audit trail | Audit rows and active versions cannot change (DB triggers) |
| F10 | MCP server | After OAuth, same permissions and 403s as the web app |
| F11 | Integration API | Key files into the active flow; same reference = one request; signed, retried webhook; revoked = 401 |
| F12 | **AI briefing** | 2–4 sentences after filing; no recommendation; on failure the request is intact and it retries |
| F13 | **Anomaly flags** | Split below a flow limit, > 3× usual, 7-day duplicate; approvers only; routing unchanged |

## 5. Out of scope (v1)
Payments, payroll, e-signature, single sign-on, native apps, automatic HR sync, free-form rule formulas.

## 6. Risks and assumptions
| Risk or assumption | Mitigation |
|---|---|
| AI drafts a rule the SOP does not say | Checked quotes, human review, second-person activation |
| Organization data wrong or unowned | Coverage test, structure findings, two organization owners |
| Process owners will not maintain flows (assumption) | Chat drafting and simulation; tested in the pilot |
