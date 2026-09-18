# Riseklix V1 AI model strategy

## Principle

Use the strongest model where commercial reasoning quality is the product. Use lower-cost / market-representative models where the job is high-volume observation, prompt wording, or deterministic extraction.

## Reasoning and utility roles

| Role | Default model | Why |
| --- | --- | --- |
| Company Intelligence + outside-in verification | GPT-5.6 Sol | Core commercial reasoning and company reconstruction |
| Buyer Intent Suggestor | GPT-5.6 Sol | Core differentiator; needs deep commercial reasoning |
| Intent-specific competitor discovery | GPT-5.6 Sol + web search | Relevance and fit matter more than marginal token cost |
| WHY evaluator | GPT-5.6 Sol | Evidence-bounded synthesis is high-value reasoning |
| Blueprint generator | GPT-5.6 Terra | Strong implementation quality with better cost balance |
| Buyer-question generator | GPT-5.6 Luna | Controlled natural-language wording task |
| Brand/rank extractor | GPT-5.6 Luna | Structured extraction from an already-produced answer |

## Observation surfaces

Approved buyer questions are frozen once, then reused across every enabled observation surface. Results remain separated by provider/surface.

| Provider | Default API surface | Default model | Consumer equivalence |
| --- | --- | --- | --- |
| OpenAI | Responses API + web search | GPT-5.6 Luna | Approximate free-plan proxy |
| Google | Gemini GenerateContent + Google Search | Gemini 3.8 Flash | Approximate API proxy |
| Anthropic | Messages API + server web search | Claude Sonnet 5 | Approximate API proxy |
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
