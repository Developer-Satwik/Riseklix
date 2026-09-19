# Riseklix V1 AI model strategy

## Principle

Use the strongest model where commercial reasoning quality is the product. Use lower-cost / market-representative models where the job is high-volume observation, prompt wording, or deterministic extraction.

## Reasoning and utility roles

| Role | Default model | Why |
| --- | --- | --- |
| Company Intelligence + outside-in verification | GPT-5.6 Sol | Core commercial reasoning and company reconstruction |
| Buyer Intent Suggestor | GPT-5.6 Sol | Core differentiator; needs deep commercial reasoning |
| Intent-specific competitor discovery | GPT-5.6 Terra + Firecrawl, conditional Sol escalation | Use the cheaper classifier when evidence is clear; escalate only when a broad retrieval set yields no defensible candidate |
| WHY evaluator | GPT-5.6 Sol | One batched cross-intent reasoning call over compact deterministic evidence; preserves high-value reasoning while removing repeated raw-answer context |
| Blueprint generator | GPT-5.6 Terra | Strong implementation quality with better cost balance |
| Buyer-question generator | GPT-5.6 Luna | Controlled natural-language wording task |
| Brand/rank extractor | GPT-5.6 Luna | Batch extraction per observation batch, with individual fallback only for omitted/failed items |

## Observation surfaces

Approved buyer questions are frozen once, then reused across every enabled observation surface. Results remain separated by provider/surface.

| Provider | Default API surface | Default model | Consumer equivalence |
| --- | --- | --- | --- |
| OpenAI | Responses API + web search | GPT-5.6 Luna | Approximate free-plan proxy |
| Google | Gemini GenerateContent + Google Search | Gemini 3.8 Flash | Opt-in API proxy; disabled until billing/quota is activated |
| Anthropic | Messages API + Firecrawl search evidence | Claude Haiku 4.5 | Approximate API proxy; not Claude native web search |
| Perplexity | Sonar API | Sonar | Approximate API proxy |

The same question text, language, geography policy and repetition count should be used on every enabled surface. This gives us a comparable panel without pretending the products are internally identical.

## Consumer-app equivalence

API observations are not represented as the consumer app.

Each observation stores:

- provider
- exact API surface
- resolved model label
- language
- geography
- fresh-session policy
- search/grounding mode
- full answer
- citations
- capture status
- retrieval status
- repetition

Never label an API result as “what ChatGPT/Gemini/Claude/Perplexity users see.” Consumer apps can add routing, product-level system instructions, personalization, location handling and search decisions that are not reproduced by the API.

## Secret handling

Provider keys belong in Supabase Edge Function Secrets:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `PERPLEXITY_API_KEY`

Never put provider secrets in GitHub, `.env.example`, browser-side `NEXT_PUBLIC_*` variables, the application database, or chat messages.

Provider subscriptions and API billing are separate products. Each API account must have the relevant billing / quota enabled.

## Product rule

Riseklix does not produce one blended “AI visibility score” and hide where it came from.

The product should show the buyer question once, then the observed answer/result from each declared surface separately. Cross-model summaries are derived only after the underlying evidence remains inspectable.


## Observation cost policy

High-volume observation should use economical models and bounded external retrieval. Claude observations default to Haiku 4.5 and receive compact Firecrawl search-result evidence instead of Anthropic's native web-search tool. This reduces token amplification and native search charges while keeping the observation methodology explicit. Gemini is opt-in through `RISEKLIX_ENABLE_GEMINI_OBSERVATIONS=true` after its API billing/quota is intentionally enabled.


## Cost-control architecture

Riseklix preserves frontier reasoning at the commercial decision gates and removes repeated model work elsewhere.

- Every OpenAI call records token usage, cached-input usage, cache writes, reasoning tokens, web-search calls and a price-snapshot estimate in `ai_usage_events`.
- GPT-5.6 prompt caching is enabled on reusable stage prefixes. Cache telemetry is visible in Method.
- WHY uses deterministic retrieval/aided/rank summaries plus a small representative excerpt set instead of resending every full model answer, and evaluates the active Buyer Situations in one structured Sol call.
- Competitor discovery defaults to Terra over Firecrawl retrieval. It escalates to Sol only when the retrieval universe is broad but the primary classifier cannot produce a defensible candidate shape.
- OpenAI brand extraction is batched; individual Luna extraction is a quality-preserving fallback.
- Blueprints remain Terra-high but run as background work using Flex pricing when available, with automatic Standard fallback.
- Rechecks reuse the frozen prompt panel, surfaces, Company Intelligence and Buyer Situations. They do not regenerate discovery inputs unless a separate refresh is explicitly requested.
- Company Intelligence and Buyer Situation generation remain Sol-medium because errors at those gates contaminate every downstream result.
