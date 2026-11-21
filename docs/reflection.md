# Reflection: building Sentinel

## What I built and why
Sentinel is an approval-workflow application for my company, a mid-size export manufacturer. Every internal system we
run, from the HR application to the ERP to our product-development application, carries its own approval logic. People
are unsure where to file a request and who will approve it, chains are long, and each reorganization means a developer
changing approvers system by system. Sentinel puts the approval rules in one place: approvers are computed from a
maintained organization tree, flows are versioned and owned by process owners, and other systems connect through an
API and signed webhooks instead of carrying their own rules. It has three AI capabilities: a drafter that turns an SOP
into a flow with checked quotes, a briefing for approvers, and anomaly flags explained in plain words.

## What I learned
**Validation has to start from the real problem.** My first validation run scored Sentinel like a startup, with market
size and competitors. It missed the point. Once I measured approvals across all our systems and was interviewed about
how approvals actually go wrong, the real gap became clear: the same logic repeated in every application. That changed
what I built next, including the inbound API and the outbound webhooks.

**AI speeds things up, but everything it produces has to be verified.** AI wrote most of the code, tests and
documents, and the automated tests passed. Running the application in a real browser still found defects they missed:
an unticked checkbox that blocked every domestic business trip, a model setting that the live AI rejected, webhooks
blocked by the platform, and a coverage check that reported problems that could not happen. Each was fixed and
retested.

## What was hard
**An organization structure that keeps changing.** Acting heads, vacant positions and temporary reporting lines are
normal for us, and our existing approver data reflects years of manual changes. I chose not to copy those approvers,
and to model the organization with owners, a second reviewer for every change, and a coverage test that shows whose
approval path would dead-end.

**Keeping the scope realistic.** There were many good ideas: master data, more integrations, an MCP server. I had to
keep asking what the minimum was that solved the problem, and leave the rest for later.

## How I worked with AI
I directed and the AI did the work. I decided the problem, the business rules and the limits, for example that the
AI may only draft and never activate or decide, and that a division head's long leave goes to the Director and then
HR. The AI wrote the code, tests and documents, and I reviewed the results and corrected the direction when it went
wrong, such as the first validation framing.

## Feedback from users
Colleagues on the IT team tried Sentinel. Their main feedback was that it is much clearer who approves a request and
why, and that the AI is very helpful. I have not made changes from that feedback yet; testing with requesters,
approvers and process owners outside IT is the next step.

## What I am proud of, and what I would do differently
I am most proud of having one place for approval rules: another system only calls the API, and the rules no longer
live in each application. If I started again, I would begin with one pilot flow end to end, including the
integration, before building the rest.

## Next version
- A real pilot with business trips, legal tickets and ERP approvals, measured against the pass marks set in the validation.
- Master data: approval limits as parameters, and reference lists such as items with their purchase price.
