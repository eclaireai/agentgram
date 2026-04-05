# Embed agentgram Predictions

Give your AI tool the ability to predict task success, estimate tokens,
and warn about known failure patterns — before the agent starts.

## 30-second setup

```typescript
import { predict } from 'agentgram'

// Before your agent starts any task:
const prediction = await predict("add stripe subscriptions to nextjs", {
  apiKey: process.env.AGENTGRAM_API_KEY,
  stack: { framework: 'nextjs', payments: 'stripe' }
})

// prediction.successProbability — 0.67
// prediction.topRisks[0].fix   — "use raw body middleware before express.json()"
// prediction.estimatedTokens   — 42000
// prediction.recommendedRecipe — "stripe-subscriptions-nextjs"
```

## What you get

- **Success probability** — will this task likely succeed without dead ends?
- **Token estimate** — how much will this cost before the agent starts?
- **Top risks** — known failure patterns with fixes, ranked by probability
- **Recipe recommendation** — the fastest path to success

## Graceful degradation

The SDK never throws. If the API is unreachable, predict() returns
confidence: 0 and your agent continues normally.

## Pricing

| Tier | Requests/min | Price |
|------|-------------|-------|
| Free | 60 | $0 |
| Pro | 1,000 | $49/mo |
| Enterprise | 10,000 | contact us |

Get an API key: https://agentgram.dev/api-keys
