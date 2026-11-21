# Idea validation: the 7 steps

Sentinel is an **internal tool for one company**, a mid-size export manufacturer with about 250 office staff. It is
not a product for sale, so "market", "customer" and "competition" are read internally: the size of the problem inside
the company, the people who have it, and the alternatives the company realistically has.

**The problem in one sentence:** every internal system has its own approval logic, so approvals are long-winded,
nobody is sure who approves what, and each change to a chain or to the organization is a development task repeated
in every system.

## Verdict: go to pilot

The problem, the people who have it, its size, and the gap are supported by evidence from three independent kinds
of source. What is not yet shown is behaviour: no request has run through Sentinel in real use. The next step is
therefore the pilot in step 6, not more building.

| # | Step | Reading | Basis |
|---|---|---|---|
| 1 | Define the Problem | **Supported** | Measured in four systems, confirmed by a year of helpdesk tickets and by the project owner |
| 2 | Profile the Target Customer | **Supported** | Requesters, approvers and process owners inside the company; tickets come from over sixty people in over twenty departments |
| 3 | Size the Market (internal opportunity) | **Supported against the stated target** | Well over twenty thousand approval items a year across systems whose source code the same IT team controls |
| 4 | Map the Competition (alternatives) | **Supported, with a caveat** | No alternative puts the rules in one place; ready-made tools were read from documentation, not trialled |
| 5 | Define Your Edge | **Partly supported** | Why now is strong; why us rests on one part-time developer and management that is aware but has not formally mandated it |
| 6 | Design a Cheap Test | **Designed, not yet run** | Three pilot flows and pass marks are fixed below |
| 7 | Stress-Test the Idea | **Risks known, one unresolved** | Nobody yet owns the organization structure |

## Target user, why now, differentiating angle
- **Target user:** office staff of one manufacturer who file requests, the managers and function heads who approve
  them, and the process owners (HR, finance, legal, engineering) who own the rules. First users: the in-house IT team.
- **Why now:** internal systems keep multiplying and each brings its own approval logic; reorganizations are
  frequent and have to be applied system by system; audit pressure for a traceable record is rising; and LLMs with
  structured output plus MCP make it feasible for one developer to build and run this.
- **Differentiating angle:** one place for approval rules across systems. Approvers are computed from a maintained
  organization tree instead of stored per system, flows are versioned data owned by process owners and drafted by AI
  with checked SOP citations, and other systems connect through an API and signed webhooks.

## How this was validated
Three kinds of evidence, kept apart so that a reader can weigh each:

1. **Measured data** from one year of the company's own systems (HR application, ERP, product-development
   application, IT helpdesk). Exact figures are withheld; the wording below is approximate on purpose.
2. **A structured interview with the project owner** (in-house IT, the person who receives the approval-related
   requests), held on 21 November 2026. These are statements, marked as such.
3. **Published sources**, each re-opened and checked against its quote by a separate checker. They are listed under
   Key sources.

An earlier run scored this idea with a generic startup rubric and looked only at the HR application. That missed the
point of the project, which is the spread of approval logic across systems, so the scope was widened to every system
and the owner was interviewed. The published sources below come from that run's research;
its scoring is superseded by this document.

## 1. Define the Problem
*Testing: A real, specific pain point exists that people actively try to solve*

**Measured**

| Finding | What it means |
|---|---|
| Approval records exist in at least four separate systems (HR application, ERP, product-development application, production portal), each with its own approver fields and status | Approval logic is scattered |
| In the HR application alone, more than ten modules carry their own approver columns; the business-trip module has a fixed chain of up to five roles, recruitment requests have five fixed status columns | A change to a chain is a change to an application |
| The recorded first-level approver matches the superior implied by the job hierarchy for only about half of employees; about two thirds of office staff had leave approved by more than one person in a year | Who approves is not something anyone can read off a rule |
| About three in ten business trips take more than three days to approve, and about three in ten get final approval only after the trip has started | Approval is often a formality after the fact |
| About half of asset mutations take more than three days, and about one in ten takes around a month | The slowest flows are the ones nobody chases |
| About one in seven purchase requisitions and one in six product-development approvals takes more than three days | The delay is not limited to HR |
| About seven percent of all IT helpdesk tickets in a year mention approval. They come from over sixty employees in over twenty departments and concern four systems. About three in ten are about who the approver is, about three in ten about an approval that is stuck. Most are handled as software-development requests | People actively try to solve it, and the way they do is to ask a developer |

**Project owner's statements**
- The complaints heard most: not knowing who the approver is, too many stages, requests stuck with nobody aware,
  every system working differently, and an organization structure that keeps changing.
- A change to an approval rule goes to IT as a ticket and a developer changes code. This happens several times a month.
- After a reorganization the previous approver keeps receiving requests, running requests hang, IT updates each
  system one by one, and the systems end up disagreeing about who reports to whom.
- When an approval is stuck, people chase by chat or phone, do the work first and get approval afterwards, or have
  someone approve on another's behalf.

**Against**
- Most leave requests and most purchase orders are approved the same day. The problem is concentrated in multi-stage
  and cross-department flows, not everywhere.
- The ticket figure is a keyword match; tickets were not read one by one.

## 2. Profile the Target Customer
*Testing: A reachable, identifiable group of people has this problem badly enough to pay*

Nobody pays; the organization spends staff time. The group is inside the company and reachable by definition.

| Who | What they lose today | Evidence |
|---|---|---|
| Requesters (office staff) | Waiting, and chasing approvers by chat | Delay figures above; owner's statement |
| Approvers and managers | Several systems to open; approvals pile up or arrive for people they no longer manage | Owner's statement; approver mismatch in the data |
| Process owners (HR, finance, legal, engineering) | Cannot change their own rules; hard to show compliance | Owner's statement; tickets filed as development requests |
| IT | Developer time on approver changes in every system | Helpdesk tickets; owner's statement |

Still missing: the same statements in the words of requesters, approvers and process owners outside IT. Five short
interviews would close this.

## 3. Size the Market
*Testing: The opportunity is large enough to build a sustainable business*

**The owner's target:** the tool is worth running if all approval types across these systems can move to one rule
engine and changing a flow no longer needs a developer. The measure is coverage and independence, not money.

- **Volume:** well over twenty thousand approval items a year: several thousand leave requests and over a thousand
  business trips in the HR application, over four thousand purchase requisitions, about five thousand purchase orders
  and about five thousand payment requests in the ERP, and about six thousand approval records in the
  product-development application.
- **Coverage is reachable:** the in-house applications are built and maintained by the same IT team, so they can be
  changed to file requests through Sentinel's API and listen for the outcome (owner's statement).
- **Independence is the open half:** today every rule change needs a developer (owner's statement, helpdesk
  tickets). Whether process owners will change flows themselves is not yet tested; it is test 3 below.
- **Running cost** is small: serverless hosting starts at USD 5 a month, and a ready-made tool at list price would
  cost about USD 45,000 a year for 250 users (see Key sources).

**Against:** counted in money alone, the case is thin. Follow-up time saved on slow requests is worth less than
part-time maintenance by one developer, because wages are low relative to software cost. The case rests on control,
traceability and not repeating the same change in every system, which is why the target is stated as coverage.

## 4. Map the Competition
*Testing: No existing solution fully solves the problem — there's a gap worth filling*

The alternatives are what the company could do instead.

| Need | Each system keeps its own approval logic | Extend each system | Chat and email | Ready-made tools read | Sentinel |
|---|---|---|---|---|---|
| One place for approval rules across systems | No | No, the rules stay per system | No | Only for flows moved into the tool; in-house applications keep their own | Yes, through the API and webhooks |
| Approver computed from an organization tree, with acting heads, vacancies, exceptions | No | Must be built in each system | No routing | Partly: one-level lookup or a stored manager chain; fails when the manager is empty | Built |
| A reorganization is entered once and open tasks move | No, each system is updated separately | No | No | Not found | Built |
| Separate authority matrix | No | Could be built per system | No | Not found as a built-in feature | Built |
| Requester never approves own request | Leaks in a few cases | Per system | No control | Present in one tool read | Enforced in the engine |
| Versioned flows, simulation, second-person activation | No | Would need building | Not applicable | Versioning yes; simulation and second-person activation not found | Built |
| Rules owned by non-developers | No | No | No written rules | Yes in no-code tools | Built, not yet tested with real process owners |
| Other systems file a request and learn the outcome | Not applicable | Not applicable | No | Yes | Built and tested; no internal system connected yet |
| Cost for about 250 users | None new, but every change costs developer time | Developer time per system | None | USD 15 per user per month at one list price; others by quote only | One in-house developer to maintain it |

**Why not a ready-made tool (owner's statements):** it cannot unify the in-house systems, it cannot follow a
structure with acting heads, vacancies and frequent changes, and it is licensed per user.

**Caveats:** "not found" means not on the documentation pages that were opened, not proven absent. No ready-made
tool was trialled side by side, and user review sites could not be opened. The ERP's own purchase-order approval is
fast and may be better left where it is.

## 5. Define Your Edge
*Testing: You have a specific reason why you — and this timing — can win*

**Why now**
- Internal systems keep being added, and each new one brings its own approval logic (owner's statement).
- Reorganizations are frequent, and each one has to be applied system by system (owner's statement; approver mismatch in the data).
- There is audit and compliance pressure for a traceable record of approvals (owner's statement).
- One developer with AI coding tools can now build and maintain this; LLMs produce reliable structured output from
  policy text, and MCP lets assistants act with the user's own permissions (published sources).

**Why us**
- The same IT team holds the source code of the in-house applications that have to be connected.
- The application exists, is deployed, and has 107 automated tests.
- The team has read access to the data that shows where approvals are slow.

**Weak points:** one developer, part time; management knows about the initiative but has not formally mandated it.

## 6. Design a Cheap Test
*Testing: People will change their behaviour (and pay) for a solution to this problem*

Nothing has been tested in real use yet. The owner chose three flows that together exercise the three hard parts:
a long chain, a second in-house module, and an outside system.

| Pilot flow | What it tests | Baseline today |
|---|---|---|
| Business trips | A four-stage chain computed from the organization tree | About three in ten take more than three days; about three in ten are approved after the trip starts |
| Legal tickets | A second module of the HR application filing through the API | Several hundred a year; fewer than half have an approval date recorded at all |
| ERP approvals (purchase requisitions first) | Integration with a system the team does not fully control | About one in seven takes more than three days |

Pass marks, fixed before the pilot (four weeks per flow, judged on the last two):

| Criterion (from the owner) | Passes if |
|---|---|
| Approval is faster | The share taking more than three days is at most half the baseline, and no business trip is approved after it starts |
| A reorganization stalls nothing | One real or staged change of unit head moves every open task to the new head with no IT intervention |
| The flow is visible | Every requester can see which step and which person their request waits on, and no ticket about "who is my approver" is filed for a pilot flow |
| Integration holds | Every request filed by the other system appears in Sentinel exactly once, and every outcome reaches the other system (no failed deliveries left) |
| Rules change without a developer | A process owner makes at least one rule change themselves |

Two cheaper checks can run before the pilot: replay about fifty past business trips through the approver calculation
and ask unit heads whether the computed approver is the right one; and five short interviews outside IT (step 2).

## 7. Stress-Test the Idea
*Testing: The risks are known and manageable — or reveal a fatal flaw before you invest*

| Risk | Level | Mitigation | What would settle it |
|---|---|---|---|
| Nobody owns the organization structure (the owner's main worry). Computing approvers from a tree needs someone to decide and maintain the correct tree | High | Organization owners with second-person review; structure findings and a coverage test in the app | HR or management accepting ownership in writing |
| One part-time developer; AI-written code nobody else knows | High | Documentation, tests, CI, generated types; a second person deploys and fixes a bug from the docs alone | A completed handover exercise |
| Sentinel becomes a single point of failure for every system's approvals | High once systems are connected | Stateless Worker on a managed platform, webhook retries, idempotent API; a documented fallback per system | An outage drill during the pilot |
| People keep using chat and the old screens | Medium | Pilot one flow at a time and switch the old screen off for it | Usage share in the pilot |
| The AI drafts a wrong rule and the reviewer accepts it | Medium | Machine-checked citations, validation, simulation, activation as a separate human step | Error count on real SOPs |
| A ready-made tool would have covered the need at lower total cost | Medium | Side-by-side trial of one tool on the company's real cases before wider rollout | The trial result and a quote |

No condition was found that makes the idea unworkable. The first risk is the one that could: if nobody decides
which structure is correct, no software can compute the right approver.

## Key sources
| Step | Evidence | Source |
|---|---|---|
| 1 | Manual leave handling is slow; purchase approvals suffer frequent paper errors | [Jurnal Minfo Polgan, 2025](https://jurnal.polgan.ac.id/index.php/jmp/article/view/14747), [Jurnal Teknik Informatika ULBI, 2021](https://ejurnal.ulbi.ac.id/index.php/informatika/article/view/1388) |
| 1 | Approvals over email and chat make it hard to prove who approved and whether they had authority | [NHI Mgmt Group](https://nhimg.org/faq/what-breaks-when-access-requests-are-handled-through-email-and-chat/) |
| 2 | About 30% of documents delayed because the approver was absent, at an Indonesian manufacturer | [JATI, ITN Malang, 2025](https://ejournal.itn.ac.id/jati/article/download/12612/6985/) |
| 3 | A manager spends up to 30 minutes per expense report when follow-up is included (vendor-commissioned study) | [TravelBank citing Forrester](https://travelbank.com/blog/expense-management/te-expense-reports) |
| 3 | Flights booked seven days or less before departure cost 44% more on average | [Concur via PR Newswire](https://prnewswire.com/news-releases/the-true-costs-of-last-minute-travel-revealed-300234071.html) |
| 3 | Serverless hosting from USD 5 per month | [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| 3 (against) | Time saved on tasks does not automatically become value | [California Management Review](https://cmr.berkeley.edu/2025/10/seven-myths-about-ai-and-productivity-what-the-evidence-really-says/) |
| 4 | A flow fails when the user has no manager in the directory | [Microsoft Tech Community](https://techcommunity.microsoft.com/discussions/powerappflow/get-manager-how-to-react-if-there-is-no-manager/394644) |
| 4 | Manager-subordinate hierarchies are not supported out of the box in a workflow engine | [Camunda Forum](https://forum.camunda.io/t/how-to-map-hierarchies-between-groups-in-camunda/53321) |
| 4 (against) | A no-code tool computes the approver from a master table | [Kissflow Help](http://help.kissflow.com/en/articles/367113-assign-a-task-based-on-a-master) |
| 4 (against) | Inbound webhooks that start a process already ship in ready-made tools | [Camunda Docs](https://docs.camunda.io/docs/components/connectors/protocol/http-webhook/), [Kissflow](https://community.kissflow.com/t/60h4af5/webhooks-by-kissflow) |
| 4 (against) | Approval rules with exclusive approval and time-boxed delegation | [Odoo Studio](https://www.odoo.com/documentation/19.0/applications/studio/approval_rules.html) |
| 5 | MCP adopted across vendors and moved to the Linux Foundation | [Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) |
| 5 (against) | LLM extraction from regulatory documents is about 85–90% accurate | [arXiv 2403.12924](https://arxiv.org/abs/2403.12924) |
| 6 | Adoption measured as share of purchase orders through the system (about 74%) | [EdTech Magazine](https://edtechmagazine.com/higher/article/2009/03/colleges-deploy-e-procurement-systems-slash-costs-and-control-spending) |
| 7 | "Turnover technical debt" when the only developer leaves | [TechDebt 2026](https://conf.researchr.org/details/TechDebt-2026/TechDebt-2026-main/4/-That-Developer-Left-the-Project-An-Introduction-and-Case-Study-of-Turnover-Techni) |
| 7 | AI-built internal tools are cheap to make but not cheap to own | [QA Wolf](https://www.qawolf.com/blog/the-graveyard-of-ai-built-internal-tools-keeps-growing) |

Each source was re-opened and its quote matched before it was listed.


## Limits of this validation
- The measured data comes from one company's systems and is reported without exact figures; outside readers cannot
  check it.
- The interview is with one person, the project owner in IT. It is first-hand for how changes are handled and
  second-hand for what requesters and approvers experience.
- Nothing has run through Sentinel in real use. Step 6 is a design.
- Ready-made tools were assessed from documentation only.
- The readings in the verdict table are the author's, made from the evidence shown here, not an independent
  scoring.
