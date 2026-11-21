# Sentinel: Product Requirements (one page)

## 1. Problem
Internal approvals are scattered: every system has its own approval logic. Leave, business trips and similar
requests run through modules of the in-house HR application, purchases and payments through the ERP, product
development through its own application, and the rest through chat and email. Three things go wrong: people are
unsure where to file a request and who will approve it, and chains are long; every change to a chain or to the
organization is a development task repeated in each system, so the systems drift apart; and nobody can reconstruct
afterwards who approved what under which rule. Evidence and sources are
in [validation.md](validation.md).

## 2. Target users
| User | Job to be done |
|---|---|
| Approver (manager, finance, IT, HR head) | Decide a queue of requests in seconds, often from a phone, with enough context to decide well |
| Requester (office employee) | Submit a request and always know where it is and who it is waiting on |
| Process owner (owner of an SOP) | Turn the SOP into a working flow and change it without a developer |
| System administrator (IT) | Set up the organization, owners, and flows; first-phase user of every function |

## 3. Goals and success metrics
| Goal | Metric | Target |
|---|---|---|
| Decisions happen on time | Share of approval tasks decided within their SLA | 90% or more |
| Approvers are never ambiguous | Requests whose approver could not be resolved | 0 in flows that pass the coverage test |
| Rules are owned by the business | Flow changes made without a code change | 100% |
| Every decision is traceable | Decisions with actor, time, flow version, and assignment reason in the audit trail | 100% |
| AI saves drafting time | Time from SOP text to a valid draft flow | Under 5 minutes |

## 4. Features and acceptance criteria
| # | Feature | Acceptance criteria (testable) |
|---|---|---|
| F1 | Submit and track a request | Given a flow in effect, when a requester submits valid form data, then a request ID is returned and the first approval task is open. Invalid or unknown fields are rejected with HTTP 400. The request list shows the step and person each open request is waiting on. |
| F2 | Approval inbox | The inbox lists only tasks assigned or delegated to the user, sorted by due date, filterable by SLA state and flow. Approving several selected tasks records one decision per task. After a decision the next task opens automatically. |
| F3 | Separation of duties | A requester can never decide their own request, including through delegation or by being listed as an approver (HTTP 403). A process owner cannot activate a draft they edited. |
| F4 | AI flow drafter | Given SOP text, the drafter returns a draft that passes validation, with a quote for each rule. A quote that is not an exact substring of the SOP is marked unverified. The drafter cannot activate a flow, and it receives no employee data. If the SOP is ambiguous it asks a question instead of changing the draft. |
| F5 | Flow validation and simulation | A definition where any path can finish without a human approval cannot be saved as valid or activated. Simulation returns the approver of every step for a given requester and form data without storing anything. |
| F6 | Structure-based approver resolution | The direct superior is the head of the requester's unit; if that head is vacant the next unit up is used and the reason says so. An active reporting exception overrides the tree. Every task stores the reason its approver was assigned. |
| F7 | Organization master with review | A change proposed by one organization owner takes effect only after a second owner approves it. When a unit head changes, open tasks move to the new head and the move is in the audit trail. The coverage test lists every person whose approval path would dead-end. |
| F8 | SLA reminders and escalation | A task past its due date sends one reminder; past twice its SLA it adds the approver's superior, never the requester. |
| F9 | Audit trail | Audit rows cannot be updated or deleted (enforced by database triggers). An active flow version cannot be changed or deleted. |
| F10 | MCP server | An MCP client that completes OAuth can call every feature as the signed-in user; a call the user is not allowed to make returns the same 403 as the web app. |
| F11 | Integration with other systems | A system holding a valid API key can file a request for an employee, and that request follows the flow in effect exactly like one filed in the app. Filing the same external reference twice creates one request. When a request is approved, rejected, or cancelled, every registered webhook and the request's callback URL receive a signed message; a failed delivery is retried and visible to administrators. A revoked key is rejected with HTTP 401. |
| F12 | AI request briefing | When a request is filed or resubmitted, the approver sees a 2–4 sentence summary written by AI (who asks for what, amounts, dates, reason, where it waits, anything missing) without waiting for it. The summary never recommends a decision. If the AI fails, the request is unaffected, the panel says so, and the summary is retried. |
| F13 | Anomaly flags | A request is flagged when, together with the same requester's requests in the same category over the last 14 days, it reaches an approval limit that each stays below; when its amount is more than 3 times the usual for the flow and category (at least 5 earlier requests); or when it duplicates a request filed in the last 7 days. Limits are read from the flow's own rules. Approvers see the flags and an AI explanation; the requester never does. Flags are recorded in the audit trail and never change routing. |

## 5. Out of scope (v1)
Payments or disbursement, payroll and leave-balance calculation, document e-signature, single sign-on, native mobile apps,
automatic sync of the organization from the HR system, and free-form formulas in rules.

## 6. Risks and assumptions
| Risk or assumption | Mitigation |
|---|---|
| The AI drafts a rule the SOP does not say | Every rule carries a machine-checked quote; a human reviews in the visual editor; activation is a separate step |
| The organization data is wrong or incomplete | Structure findings and the coverage test surface gaps before a flow or change takes effect |
| A single administrator bypasses review | Allowed in the first phase only; each override is flagged `adminOverride` in the audit trail |
| Process owners do not maintain flows themselves (assumption) | Chat-based drafting and simulation lower the effort; tested in the pilot described in validation.md |
| AI usage cost on a public test URL | Usage goes through AI Gateway, where a spend limit is set |

**Differentiating angle:** approval rules are data owned by the people accountable for the SOP, drafted by AI with
verifiable citations, and approvers are computed from the organization with a stated reason, instead of being typed
in per person.
