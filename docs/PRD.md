# Sentinel: Product Requirements Document (one page)

Six components: problem, target users, goals and metrics, features with acceptance criteria, out of scope, risks.
Evidence is in [validation.md](validation.md); technical detail and the test for each criterion are in [spec.md](spec.md).

## 1. Problem
Every internal system (HR application, ERP, product development, chat and email) carries its own approval logic.
People are unsure where to file and who approves, chains are long, each reorganization is a developer task repeated in
every system, and nobody can reconstruct who approved what under which rule. **Angle:** one place for approval rules,
owned by process owners, drafted by AI from the SOP with checked quotes, with approvers computed from the organization.

## 2. Target users
| User | Job to be done |
|---|---|
| Requester (office employee) | File a request and always see where it is and who it waits on |
| Approver (unit head, finance, IT, HR) | Decide a queue in seconds, often from a phone, with enough context |
| Process owner (owner of an SOP) | Turn the SOP into a working flow and change it without a developer |
| System administrator (IT) | Set up the organization, owners and integrations; first-phase user |

## 3. Goals and success metrics
| Goal | Metric | Target |
|---|---|---|
| Decisions on time | Approval tasks decided within their SLA | ≥ 90% |
| No ambiguous approver | Requests whose approver cannot be resolved | 0 in flows that pass the coverage test |
| Rules owned by the business | Flow changes made without a code change | 100% |
| Traceable decisions | Decisions with actor, time, flow version and assignment reason | 100% |
| AI saves drafting time | SOP text to a valid draft flow | < 5 minutes |

## 4. Features and acceptance criteria
| # | Feature | Acceptance criteria (testable) |
|---|---|---|
| F1 | Submit and track | Valid data returns a request ID and opens the first task; invalid fields return HTTP 400; the list shows who each request waits on |
| F2 | Approval inbox | Shows only tasks assigned or delegated to the user, by due date; bulk approve records one decision per task |
| F3 | Separation of duties | A requester never decides their own request, even through delegation (HTTP 403); a draft's editor cannot activate it |
| F4 | **AI flow drafter** | From SOP text, returns a draft that passes validation with a quote per rule; a quote not found in the SOP is marked unverified; asks when the SOP is ambiguous; cannot activate |
| F5 | Validation and simulation | A path that can end without a human approval cannot be activated; simulation shows each step's approver without storing anything |
| F6 | Approvers from the organization | Superior = head of the requester's unit; a vacant head escalates upward with the reason stated; each task stores its reason |
| F7 | Organization changes | A change applies only after a second owner approves; open tasks move to the new head with an audit event; the coverage test lists dead-end paths |
| F8 | SLA | Past due: one reminder; past twice the SLA: the approver's superior is added, never the requester |
| F9 | Audit trail | Audit rows and active flow versions cannot be changed or deleted (database triggers) |
| F10 | MCP server | After OAuth, every feature is callable as the signed-in user, with the same 403s as the web app |
| F11 | Integration | A valid API key files a request that follows the active flow; the same external reference creates one request; outcomes go out as signed webhooks, retried on failure; a revoked key gets HTTP 401 |
| F12 | **AI request briefing** | A 2–4 sentence summary appears after filing without waiting; never recommends a decision; on AI failure the request is unaffected and the summary is retried |
| F13 | **Anomaly flags** | Flags a purchase split below a limit read from the flow, an amount > 3× the usual (≥ 5 earlier requests), or a duplicate within 7 days; shown with an AI explanation to approvers only; never changes routing |

## 5. Out of scope (v1)
Payments, payroll and leave balances, e-signature, single sign-on, native mobile apps, automatic sync from the HR
system, free-form formulas in rules.

## 6. Risks and assumptions
| Risk or assumption | Mitigation |
|---|---|
| The AI drafts a rule the SOP does not say | Machine-checked quotes, human review, activation by a second person |
| Organization data is wrong, or nobody owns it | Structure findings, coverage test, two organization owners |
| Process owners will not maintain flows themselves (assumption) | Chat drafting and simulation; tested in the pilot in validation.md |
| AI cost on a public test URL | All calls go through AI Gateway with a spend limit |
