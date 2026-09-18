# Riseklix V1 — Product Experience Principles

This document turns current UX research into concrete product rules for Commercial Discovery V1.

## Product posture

Riseklix is sophisticated underneath and calm on top.

The customer should not operate the research machinery. They should make a small number of commercial decisions:

1. Is our company context correct?
2. Which Buyer Situations deserve testing?
3. What happened?
4. Why might it be happening?
5. What work is justified?
6. Did anything change afterward?

## Research translated into design rules

### 1. Progressive disclosure, not feature hiding

Nielsen Norman Group's guidance on progressive disclosure is a direct fit for Riseklix: show the small set of options people need now, with advanced evidence available one level deeper.

Implementation rule:
- conclusions and decisions are default
- methodology, raw prompts, citations, source packets, constraint ladders, repetitions and model metadata sit inside clearly labelled secondary views
- do not create more than two disclosure levels

Source: https://www.nngroup.com/articles/progressive-disclosure/

### 2. One meaningful task per stage

Complex forms and analytical workflows create avoidable cognitive load when everything appears at once. Riseklix stages the workflow rather than asking the user to configure the entire research system upfront.

Implementation rule:
- Company Profile asks the user to confirm the business premise
- Buyer Situations asks which commercial decisions are legitimate
- WHY asks which interpretations are supported
- Fixes asks what work deserves execution
- Recheck asks what changed
- no screen should ask the customer to solve two unrelated problems

Source: https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/

### 3. Strategic minimalism

2026 SaaS design is moving toward calmer default views: less chrome, less dashboard density, one dominant CTA, and complexity revealed only when useful.

Implementation rule:
- one dominant action per screen
- no metric exists merely because it can be calculated
- Overview is a decision brief rather than a KPI wall
- raw evidence is available, never mandatory reading
- typography and spacing carry hierarchy before color does

Reference: https://www.saasui.design/blog/7-saas-ui-design-trends-2026

### 4. AI should live inside the workflow

The interface should not become “normal software + a chatbot in the corner.” AI acts through structured workflow states: research, suggest, explain, generate, verify.

Implementation rule:
- do not expose a generic chat panel as the primary product
- contextual “Ask Riseklix” can come later, but it must query structured project evidence
- model-generated output always lands in a reviewable product object: Company Profile, Buyer Intent, Finding or Blueprint

Reference: https://www.sap.com/india/design/stories-resources/the-future-of-enterprise-ux

## Color system

The visual language uses warm editorial neutrals because Riseklix should feel like a research dossier rather than an SEO dashboard.

### Neutral foundation

- Canvas: near-black, not absolute black
- Panels: subtle neutral value shifts establish zones
- Evidence/diagnostic paper: warm cream
- Text: warm off-white rather than pure white

This follows the same general principle used in mature design systems such as Carbon: neutral families dominate the UI and additional colors are used deliberately.

Reference: https://carbondesignsystem.com/elements/color/overview/

### Semantic color

Color is functional, not decorative.

- Coral: problem/action justified
- Gold: investigation/uncertainty/attention
- Blue: monitoring/information
- Sage: healthy/verified
- Gray: draft/not started

No business conclusion may rely on color alone. Status always includes a label, and where useful also shape/symbol.

Reference: https://v10.carbondesignsystem.com/patterns/status-indicator-pattern/

### Accessibility

- normal text target: WCAG AA 4.5:1 contrast
- large text target: at least 3:1
- interactive boundaries/status graphics: at least 3:1 where applicable
- never use faint 7–9px gray text as the only carrier of important information

Reference: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

## Typography

Riseklix uses two voices:

- editorial serif: interpretation, conclusions, major questions
- clean sans-serif: controls, evidence, structured data
- monospace: IDs, versions, collection metadata only

Do not make analytical credibility depend on tiny typography. Body copy should normally sit around 12–15px in product UI, with important interpretation larger.

## Interaction principles

### Default = business mode

Show:
- conclusion
- decision
- next action
- evidence strength

Hide until requested:
- raw prompt variants
- source metadata
- constraint-relaxation details
- run IDs
- model/session metadata
- full JSON-like structures

### Evidence is always reachable

Every important claim must have a path to its supporting evidence.

The user should be able to move:
conclusion → explanation → evidence

without navigating to a separate analytics product.

### Trust before delight

The interface may be beautiful, but visual polish must never make uncertain model output look more certain.

Use explicit labels such as:
- Observed
- Interpretation
- Possible explanation
- Needs confirmation
- No change justified
- Delivery verified
- Impact not yet measured

## Motion

Motion is quiet and functional:
- hover and disclosure transitions only
- no looping decoration in the application
- respect prefers-reduced-motion
- loading states should explain what the system is researching rather than showing decorative spinners only

## The one permanent product rule

**Never make the customer do analysis Riseklix can do for them.**
