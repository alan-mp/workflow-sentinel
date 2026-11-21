# Idea validation: the 7 steps

Sentinel was validated with the course's 7-Step Validation in Deep Research mode on 21 November 2026.
The full report, with all 139 verified evidence items, quotes, judge notes, and 98 sources, is in
[validation-report.html](validation-report.html) (in Indonesian; download and open in a browser).

## Result: Fix first

Every step is **Partial**. No step was refuted and neither judge found a fatal flaw, but step 1 is not yet
Proven, so the written rules give **Fix first** rather than Go: the evidence supports the idea but does not settle it,
and the cheap tests in step 6 should run before more is invested.

This is the honest outcome of desk research on an internal tool: the strongest evidence is one company's own data, and
nothing short of a pilot can show that people will change how they work.

## How it was done
Sixteen agents with separated roles, so that no role could favor the idea: one researcher per step collected evidence
for and against; one source checker per step re-opened every URL and matched every quote (139 of 140 items passed,
one was dropped); two judges on different models scored each step blind from the verified evidence only. Statuses and
the recommendation come from a written rubric, not from anyone's opinion. The judges agreed on all seven steps.

## Summary
| # | Step | Status | What the evidence says |
|---|---|---|---|
| 1 | Define the Problem | Partial | Internal data shows approver assignments are inconsistent with the organization structure, and requesters occasionally sit in their own approval chain. Indonesian case studies describe slow, error-prone manual approvals. Missing: direct words from requesters and approvers that this hurts. |
| 2 | Profile the Target Customer | Partial | The group is identifiable: approvers and site managers, plus IT admins who end up unblocking stuck approvals. One Indonesian manufacturer recorded about 30% of documents delayed for days because the approver was absent. Missing: proof the organization will spend budget or staff time. |
| 3 | Size the Market | Partial | Indonesia has about 35,000 medium and large manufacturers (BPS). Per-seat prices are low, and approvals are already bundled in tools many companies own. No target size was set, so Partial is the ceiling. |
| 4 | Map the Competition | Partial | Mainstream tools handle a vacant approver badly, and some treat a skipped approval as approved. But several pieces of the idea already exist: policy-document AI in ServiceNow, position-based routing in Workday, structure-based leave approval in local HRIS. The gap is the combination, not any one feature. |
| 5 | Define Your Edge | Partial | Why now is supported: structured LLM output, MCP as a cross-vendor standard, and near-zero running cost on serverless. Why us rests on insider knowledge of the data, which is a user claim. Counter-evidence: in-house tools are often abandoned, and LLM extraction from policy text is roughly 85–90% accurate. |
| 6 | Design a Cheap Test | Partial | No real test of this idea has run yet. Comparable rollouts measured adoption by share of transactions, not by people trained, and reported faster cycle times. Three tests are designed below. |
| 7 | Stress-Test the Idea | Partial | Risks are identified from real cases, but three high risks have no proven mitigation yet: one-developer dependency, organization data quality, and adoption. |

## Key sources
| Step | Evidence | Source |
|---|---|---|
| 1 | Manual leave handling is slow; purchase approvals suffer frequent paper errors | [Jurnal Minfo Polgan, 2025](https://jurnal.polgan.ac.id/index.php/jmp/article/view/14747), [Jurnal Teknik Informatika ULBI, 2021](https://ejurnal.ulbi.ac.id/index.php/informatika/article/view/1388) |
| 1 (against) | Off-the-shelf HRIS already offers structure-based leave approval | [Mekari Talenta](https://www.talenta.co/solusi/aplikasi-cuti-karyawan/) |
| 2 | About 30% of documents delayed because the approver was absent; solved there with existing Microsoft 365 tools | [JATI, ITN Malang, 2025](https://ejournal.itn.ac.id/jati/article/download/12612/6985/) |
| 2 (against) | Approvals cost nothing extra for organizations already licensed for Office 365 | [Microsoft Learn](https://learn.microsoft.com/en-us/power-automate/get-started-approvals) |
| 3 | 35,134 active medium and large manufacturing establishments in 2025 | [BPS, Direktori Industri Manufaktur 2025](https://www.bps.go.id/id/publication/2025/10/31/847210bbc042641bccee9ecb/direktori-industri-manufaktur-2025.html) |
| 3 (against) | Local HRIS with multi-level approval lists at Rp 12,500–20,000 per employee per month | [Gadjian pricing](https://gadjian.com/price) |
| 4 | No option to reroute or escalate when the approver position is vacant | [SAP Knowledge Base 3617763](https://userapps.support.sap.com/sap/support/knowledge/en/3617763) |
| 4 | A skipped approval is treated as approved in the default workflow | [ServiceNow Community](https://www.servicenow.com/community/developer-articles/workflow-skipped-approvals-result-in-approved/ta-p/2302984) |
| 4 (against) | Natural-language policy documents applied to approvals already ship | [ServiceNow Docs](https://www.servicenow.com/docs/r/zurich/build-workflows/intelligent-approvals.html) |
| 5 | MCP adopted across vendors and moved to the Linux Foundation | [Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) |
| 5 (against) | LLM extraction from regulatory documents is about 85–90% accurate | [arXiv 2403.12924](https://arxiv.org/abs/2403.12924) |
| 6 | Adoption measured as share of purchase orders through the system (about 74%) | [EdTech Magazine](https://edtechmagazine.com/higher/article/2009/03/colleges-deploy-e-procurement-systems-slash-costs-and-control-spending) |
| 7 | "Turnover technical debt" when the only developer leaves | [TechDebt 2026](https://conf.researchr.org/details/TechDebt-2026/TechDebt-2026-main/4/-That-Developer-Left-the-Project-An-Introduction-and-Case-Study-of-Turnover-Techni) |
| 7 | Requiring people to correct AI errors lowered engagement and raised acceptance of AI suggestions | [arXiv 2509.08514](https://arxiv.org/abs/2509.08514) |

Links are as recorded by the researchers; the full list with titles and dates is in the report.

## Target user and "why now"
- **Target user:** approvers and process owners at a mid-size Indonesian manufacturer with a few hundred office
  staff; in the first phase, the company's own IT team.
- **Why now:** LLMs can reliably produce structured output from policy text, MCP lets assistants use the same
  functions with the user's permissions, and a serverless platform makes an internal tool almost free to run.
- **Differentiating angle:** the combination of versioned flows with second-person activation, AI drafting with
  machine-checked citations, approvers computed from the organization with vacancy escalation and a stated reason,
  and an authority matrix. Individual pieces exist elsewhere; no product the research found does all of them.

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
| An existing HRIS, ERP, or Microsoft 365 feature makes the tool redundant | Medium | Side-by-side comparison on the vacant-approver and self-approval cases before wider rollout | The comparison result |

The stress test found no condition that makes the idea unworkable. It did name one conditional risk: if nobody in HR
or management decides which organization structure is correct and maintains it, computing approvers from it cannot
work however well the software is built.

## Limits of this validation
- The internal evidence comes from one company's HR data and is reported without exact figures; outside readers
  cannot check it.
- Review sites (G2, Capterra) and Reddit could not be opened, so there are no user ratings or complaints from them.
- The "ten real people" target in step 2 was not met: seven voices were found, all from other countries or industries.
- No target market size was set, which caps step 3 at Partial.
