# Idea validation: the 7 steps

Sentinel was validated with the course's 7-Step Validation in Deep Research mode on 21 November 2026.
The full report, with all 149 verified evidence items, quotes, judge notes, and 93 sources, is in
[validation-report.html](validation-report.html) (in Indonesian; download and open in a browser).

## What is being validated
Sentinel is an **internal tool for one company**, a mid-size export manufacturer with about 250 office staff.
It is not a product for sale: there is no market, no customers, and no revenue. The question is whether it closes
a real gap compared with how approvals work at the company today:

- **Modules of the in-house HR application.** Leave, business trips and other request types each have their own
  module, and each module carries its own approver columns and rules.
- **Chat and email** for everything else, and for chasing requests that are stuck.

The gap, in one sentence: approval logic is scattered across modules and channels, so people are unsure where to
file a request and who will approve it, and changing a chain means changing an application.

The seven step names and "Testing" sentences are used as written in the course material. Two are read internally:
step 3 measures the size of the internal problem against the cost of running the tool (not a market), and step 4
compares the realistic alternatives the company has (not market competitors).

## Result: Fix first

Every step is **Partial**. No step was refuted and neither judge found a fatal flaw, but step 1 is not yet
Proven, so the written rules give **Fix first** rather than Go.

The problem is measured in the company's own data, but all of those measurements come from one source and describe
records, not what people say or do about it. The two things that would move the result are direct statements from
requesters, approvers and process owners, and the outcome of one real pilot.

## The gap in the company's own data
Measured from one year of HR records for office staff. Exact figures are withheld; outside readers cannot check them.

| Finding | What it means |
|---|---|
| More than ten HR modules each carry their own approver columns; the business-trip module has a fixed chain built into its table | Approval logic is scattered, and adding a request type or changing a chain is a development task |
| The recorded first-level approver matches the superior implied by the job hierarchy for only about half of employees | The stored approver cannot be trusted as "the superior" |
| Most departments had more than one person acting as department-head approver for business trips; about two thirds of office staff had leave approved by more than one person in a year | Who approves depends on the request, not on a rule anyone can read |
| A business trip passes about four approval stages; about three in ten take more than three days, and about three in ten get final approval only after the trip has started | Approval is often a formality after the fact rather than a control |
| Most leave is approved the same day, but roughly one in seven takes more than three days | Delay is concentrated in a minority of requests |
| A small number of requests had the requester in their own approval chain | Separation of duties is not enforced |

## How it was done
Separated roles, so that no role could favor the idea: one researcher per step collected evidence for and against;
one source checker per step re-opened every URL and matched every quote (149 of 150 items passed); two judges on
different models scored each step blind from the verified evidence only. Statuses and the recommendation come from
a written rubric. The judges agreed on all seven steps.

This is the second run. The first run framed Sentinel as a product with a later market of other manufacturers,
which produced market sizing and a SaaS competitor comparison that did not fit the project. The brief was rewritten
for the internal scope, steps 3 and 4 were researched and checked again from scratch, the internal measurements above
were added, and all seven steps were judged again.

## Summary
| # | Step | Status | What the evidence says |
|---|---|---|---|
| 1 | Define the Problem | Partial | The company's own data shows scattered approval logic, inconsistent approvers, and late approvals. But it is one source and measures records, not complaints or workarounds. Counter-evidence: most leave is approved the same day. Missing: direct words from the people involved. |
| 2 | Profile the Target Customer | Partial | The group is identifiable and reachable because it is inside the company: approvers, requesters, process owners. Whether the organization will spend staff time on it has no direct evidence yet. |
| 3 | Size the Market (internal opportunity) | Partial | Roughly nine to thirteen thousand approval decisions a year in the two measured request types. Follow-up time that could be saved is worth less than part-time maintenance by one developer; the case only balances when unmeasured request types, after-the-fact approvals, or avoided licences (about USD 45,000 a year at list price for 250 users) are counted. No target was set, so Partial is the ceiling. |
| 4 | Map the Competition (alternatives) | Partial | Keeping or extending the HR modules leaves the logic scattered; chat and email have no routing or audit trail. Ready-made tools already cover several needs (dynamic approver from a master table, versioned flows, inbound webhooks, time-boxed delegation). Not found in the tools read: approvers computed from an organization tree with acting heads, vacancies and exceptions; simulation; second-person activation. |
| 5 | Define Your Edge | Partial | Why now is supported: structured LLM output, MCP as a cross-vendor standard, near-zero running cost on serverless. Why us rests on access to the company's data and a working application, which are user claims. Counter-evidence: in-house tools are often abandoned. |
| 6 | Design a Cheap Test | Partial | No real test of this idea has run yet. Comparable rollouts measured adoption by share of transactions and reported faster cycle times. Three tests are designed below. |
| 7 | Stress-Test the Idea | Partial | Risks are identified, but three high risks have no proven mitigation yet: one-developer dependency, organization data quality, and adoption. |

## Gap matrix (step 4)
| Need | HR modules as they are | Extend the HR application | Chat and email | Ready-made tools read | Sentinel |
|---|---|---|---|---|---|
| Approver computed from an organization tree, with acting heads, vacancies, exceptions | No | Must be built per module | No routing | Partly: one-level lookup or a stored manager chain; fails when the manager is empty | Built |
| Separate authority matrix | No | Could be built | No | Not found as a built-in feature | Built |
| Requester never approves own request | Leaks in a few cases | Per module | No control | Present in one tool read | Enforced in the engine |
| Versioned flows, simulation, second-person activation | No | Would need building | Not applicable | Versioning yes; simulation and second-person activation not found | Built |
| Rules owned by non-developers | No | No | No written rules | Yes in no-code tools | Claimed, not yet tested with real process owners |
| Inbound API for other systems to file a request | No (assumed) | Would need building | No | Yes | Built after this validation |
| Outbound webhook when an approval finishes | No (assumed) | Would need building | No | Not verified | Built after this validation |
| Cost for about 250 users | None new | Developer time per module | None | USD 15 per user per month at one list price; others by quote only | One in-house developer to maintain it |

"Not found" means not on the documentation pages that were opened, not proven absent. User review sites could not
be opened. The Sentinel column describes the application in this repository; the research had no outside evidence
for it. The validation run recorded the inbound API and webhooks as planned; they were built in response to it and
are specified in [spec.md](spec.md).

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

The full list with titles and dates is in the report.

## Target user and "why now"
- **Target user:** approvers, requesters and process owners inside the company; in the first phase, its own IT team.
- **Why now:** LLMs can reliably produce structured output from policy text, MCP lets assistants use the same
  functions with the user's permissions, and a serverless platform makes an internal tool almost free to run.
- **Differentiating angle:** one place for approval logic instead of one set of rules per module. Approvers are
  computed from the organization tree with vacancy escalation and a stated reason, flows are versioned and activated
  by a second person, and other systems connect through an API and webhooks rather than carrying their own rules.

## Cheap tests (step 6)
Pass marks were fixed before running any test. They are design choices, not figures from a source.

| Test | Assumption tested | Duration | Passes if |
|---|---|---|---|
| 1. Process owners build a flow from their own SOP without the developer | Process owners will maintain flows themselves | 1 week, 5 people | At least 4 of 5 reach activation within 60 minutes with no approval step missing |
| 2. Replay about 50 past business-trip requests through the approver calculation | The organization tree gives the approver the business considers correct | 3–5 days | The HR process owner judges at least 45 of 50 correct, and no requester is in their own chain |
| 3. Live pilot of IT access requests | People actually switch from chat and email | 2 weeks baseline, 4 weeks pilot, judged on weeks 3–4 | At least 80% of requests go through the app, at least 80% are decided within SLA without chasing, median time to decision falls at least 30%, and one non-IT function head commits in writing to move a process |

## Risk register (step 7)
| Risk | Level | Mitigation | Evidence that would change the assessment |
|---|---|---|---|
| One in-house developer; AI-written code nobody else knows | High | Documentation, tests, CI, and a second person who has deployed and fixed a bug from the docs alone | A completed handover exercise |
| Organization data is inconsistent, and computing approvers from a tree needs one agreed structure | High | Organization owners with second-person review; structure findings and the coverage test; test 2 above | HR's written ownership of the tree and the result of reconciling it |
| Low adoption; people keep using chat and email | High | Pilot with one process and fixed adoption thresholds; phone-first approval; test 3 above | Usage data from the pilot |
| The AI drafts a wrong rule and the reviewer accepts it | Medium | Machine-checked citations, validation, simulation, and activation as a separate human step | Error rate of AI drafts measured in test 1 |
| A ready-made tool, or extending the current HR application, would cover the need at lower cost | Medium | Side-by-side trial of one ready-made tool on the company's real cases (vacant head, acting head, requester in own chain) and a quote for about 250 users | The trial result and the quote |
| Other systems cannot hand requests to Sentinel or learn the outcome, so approval logic stays scattered | Medium | Inbound API and signed outbound webhooks (built) | One internal system integrated end to end |

The stress test found no condition that makes the idea unworkable. It did name one conditional risk: if nobody in HR
or management decides which organization structure is correct and maintains it, computing approvers from it cannot
work however well the software is built.

## Limits of this validation
- The internal evidence comes from one company's HR data and is reported without exact figures; outside readers
  cannot check it, and the judges counted all of it as a single source.
- That scattered approval logic confuses people is the project owner's statement. The data measures the scatter,
  not the confusion.
- The step 3 calculation uses assumed inputs (exact volumes, leave stages, maintenance share, exchange rate).
- Review sites (G2, Capterra, GetApp, Software Advice) could not be opened, so there are no user complaints about
  the ready-made tools.
- No target size was set for step 3, which caps it at Partial.
