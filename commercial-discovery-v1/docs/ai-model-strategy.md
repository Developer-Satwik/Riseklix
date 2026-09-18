# Riseklix V1 AI model strategy

## Principle

Use the strongest model where commercial reasoning quality is the product, and use low-cost / market-representative models where the goal is high-volume observation or deterministic extraction.

## Current OpenAI role map

| Role | Default model | Why |
| --- | --- | --- |
| Company Intelligence interpretation | GPT-5.6 Sol | Core commercial reasoning; low volume |
| Buyer Intent Suggestor | GPT-5.6 Sol | Core differentiator; needs deep reasoning |
| Intent-specific competitor discovery | GPT-5.6 Sol + web search | Research quality matters more than marginal token cost |
| WHY evaluator | GPT-5.6 Sol | Evidence-bounded synthesis is high-value reasoning |
| Blueprint generator | GPT-5.6 Terra | Strong implementation quality with better cost balance |
| Prompt-expression generator | GPT-5.6 Luna | Controlled wording task, high volume |
| Brand/rank extractor | GPT-5.6 Luna | Structured extraction from an existing answer |
| OpenAI observation proxy | GPT-5.6 Luna | Closest API model to the current ChatGPT Free model |

## Consumer-app equivalence

API observations are not represented as the consumer app.

For OpenAI, the observation surface defaults to GPT-5.6 Luna, no explicit reasoning, and automatic web-search tool use. This is intentionally labelled a **free-plan proxy** because ChatGPT Free currently uses GPT-5.6 Luna, but the ChatGPT consumer product still has its own system instructions, routing, personalization, UI behavior and search decisions.

Do not label API results as “ChatGPT Free rank” or “what ChatGPT users see.”

The same rule applies when Gemini, Claude and Perplexity observation adapters are added:

- record provider
- record exact surface
- record model label when known
- record plan/proxy policy
- keep consumer-product behavior separate from API behavior

Perplexity Standard is especially important: the free product says it chooses the best model for the query, so a single fixed API model cannot be claimed to reproduce the Standard consumer experience.

## Secret handling

The only required secret for the current OpenAI-backed V1 workers is:

`OPENAI_API_KEY`

It belongs in Supabase Edge Function Secrets, never in:

- GitHub source
- `.env.example`
- browser-side `NEXT_PUBLIC_*` variables
- the application database
- chat messages

ChatGPT subscriptions and OpenAI API billing are separate. The API organization must have API billing/credits enabled.

## Future provider secrets

When additional observation providers are implemented, use provider-specific Edge Function secrets, for example:

- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `PERPLEXITY_API_KEY`

Those keys should power separately declared observation surfaces rather than being abstracted into a fake universal “AI rank.”
