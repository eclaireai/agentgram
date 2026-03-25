# agentgram Recipe Registry

> **39 recipes** for what developers, DevOps, security teams, and business builders actually need in 2026.

## What is this?

When an AI agent adds Stripe for the 50th time, it shouldn't reinvent the pattern from scratch. These recipes are the exact steps, in the exact order, that work. Distilled from real sessions, organized by burning need.

**Use with agentgram:**

```bash
npm install -g agentgram
agentgram recipe search "stripe subscriptions"
agentgram recipe pull stripe-subscriptions
agentgram memory import  # load all recipes into agent memory
```

## The 39 Recipes

### 🤖 Ai
AI & LLM integration — chatbots, RAG, structured output, MCP servers

  - [**AI Streaming Chat (Vercel AI SDK)**](./ai/vercel-ai-sdk-chat/) — Add a streaming GPT-4o chatbot to any Next.js app in under 30 minutes
  - [**RAG Pipeline with pgvector**](./ai/rag-pgvector/) — Production RAG: embed your docs, store in Postgres, semantic search in <100ms
  - [**AI Structured Output (Tool Calls)**](./ai/openai-structured-output/) — Make AI return typed JSON every time — no more parsing hallucinated strings
  - [**Local AI with Ollama**](./ai/ollama-local-ai/) — Run Llama 3, Mistral, and Phi-3 locally — zero API cost, full privacy
  - [**AI Image Generation**](./ai/ai-image-generation/) — Generate, edit, and vary images with DALL-E 3 and Replicate Flux
  - [**MCP Server (Model Context Protocol)**](./ai/mcp-server/) — Give Claude and GPT-4 direct access to your database, APIs, and files
  - [**LangChain Agent with Tools**](./ai/langchain-agent/) — Build an AI agent that can search, browse, and call your APIs autonomously

### 🔐 Auth
Modern auth — Clerk, Supabase, Auth.js (not DIY JWT)

  - [**Clerk Auth for Next.js**](./auth/clerk-nextjs/) — Complete auth with social login, MFA, and user management in 10 minutes
  - [**Supabase Auth with Social Login**](./auth/supabase-auth/) — Auth + database + realtime in one — the Firebase alternative that uses Postgres
  - [**Auth.js v5 (Next-Auth)**](./auth/auth-js-v5/) — Framework-agnostic auth with 50+ OAuth providers — the open-source standard
  - [**API Key Authentication**](./auth/api-key-auth/) — Secure your API with hashed keys, scopes, rate limits, and usage tracking

### 💳 Payments
Revenue — Stripe checkout, subscriptions, Lemon Squeezy

  - [**Stripe Checkout**](./payments/stripe-checkout/) — Accept payments in 30 minutes — one-time, saved cards, Apple Pay included
  - [**Stripe Subscriptions (SaaS Billing)**](./payments/stripe-subscriptions/) — Monthly/annual billing, usage limits, plan upgrades, and customer portal
  - [**Lemon Squeezy (Digital Products)**](./payments/lemon-squeezy/) — Sell digital products globally — Lemon Squeezy handles VAT, tax, and compliance

### ⚡ Realtime
Live features — file uploads, background jobs, WebSockets, email

  - [**File Uploads with UploadThing**](./realtime/uploadthing-files/) — Type-safe file uploads with progress tracking, validation, and CDN delivery
  - [**Background Jobs with Inngest**](./realtime/inngest-background-jobs/) — Durable async workflows that survive server restarts — no Redis, no Bull, no workers
  - [**Transactional Email with Resend**](./realtime/resend-email/) — Beautiful HTML emails with React Email — and actually get delivered to inbox
  - [**Real-Time with Supabase**](./realtime/supabase-realtime/) — Live cursors, presence, and database change streaming — no WebSocket server needed
  - [**Job Queues with BullMQ + Redis**](./realtime/bullmq-redis-queues/) — High-throughput job queues with retries, concurrency, and delayed jobs

### 🚀 Devops
Ship and scale — Docker, GitHub Actions, Terraform, K8s, Cloudflare

  - [**Production Docker Setup**](./devops/docker-production/) — Multi-stage builds, health checks, non-root user, and secrets — done right
  - [**GitHub Actions CI/CD**](./devops/github-actions-ci/) — Fast CI with dependency caching, parallel jobs, and automated deploys on merge
  - [**Terraform AWS Infrastructure**](./devops/terraform-aws/) — VPC, ECS Fargate, RDS Postgres, and ALB — production AWS in code
  - [**Kubernetes Deployment with Helm**](./devops/kubernetes-helm/) — Deploy any app to K8s with HPA, rolling updates, and secret management
  - [**Cloudflare Workers + D1**](./devops/cloudflare-workers/) — Deploy serverless API to 300+ edge locations with SQLite at the edge
  - [**OpenTelemetry Full Observability**](./devops/opentelemetry-observability/) — Traces, metrics, and logs in one — vendor-neutral observability for any stack

### ✨ Dx
Developer experience — monorepo, UI kit, type-safe APIs, analytics, search

  - [**Turborepo Monorepo**](./dx/turborepo-monorepo/) — Web app + mobile + API + shared packages — one repo, 10x faster builds
  - [**shadcn/ui + Tailwind v4**](./dx/shadcn-tailwind-v4/) — The component library that owns no code — beautiful, accessible, yours to modify
  - [**Drizzle ORM + PostgreSQL**](./dx/drizzle-postgres/) — Type-safe SQL that feels like writing SQL — migrations, relations, zero runtime overhead
  - [**tRPC v11 Type-Safe API**](./dx/trpc-v11/) — End-to-end type-safe API — no codegen, no REST, just TypeScript
  - [**PostHog Analytics + Feature Flags**](./dx/posthog-analytics/) — Event tracking, funnels, session replay, and feature flags — open source
  - [**Full-Text Search with Meilisearch**](./dx/meilisearch-search/) — Instant search with typo tolerance in <50ms — self-hosted or cloud

### 🛡️ Security
Ship safe — OWASP API top 10, secrets management, automated scanning

  - [**OWASP API Security Top 10**](./security/owasp-api-top10/) — Harden your API against the 10 most exploited vulnerabilities in production
  - [**Secrets Management (Doppler)**](./security/secrets-management/) — Zero .env files in production — secrets rotated, audited, and synced everywhere
  - [**CodeQL Security Scanning + Dependabot**](./security/codeql-security-scanning/) — Catch vulnerabilities in your code and dependencies automatically — before they ship
  - [**Advanced Rate Limiting (Upstash)**](./security/advanced-rate-limiting/) — Per-user rate limits with Redis — survives horizontal scaling and serverless

### 📱 Mobile
Apps — Expo React Native, PWA, Capacitor, n8n automation

  - [**React Native with Expo EAS**](./mobile/expo-eas/) — Build iOS and Android from one codebase — OTA updates, no App Store wait
  - [**Progressive Web App with Next.js**](./mobile/pwa-nextjs/) — Install your web app on any device — offline support, push notifications, home screen
  - [**Web to iOS/Android with Capacitor**](./mobile/capacitor-mobile/) — Ship your existing web app as a native iOS and Android app today
  - [**n8n Workflow Automation**](./mobile/n8n-automation/) — No-code automation for non-tech users — connect 400+ apps without writing code

## Structure

Each recipe folder contains:
- **`recipe.json`** — machine-readable steps, parameters, and metadata
- **`README.md`** — human-readable description, WHY it exists, and step-by-step breakdown

## Contributing

Found a workflow that saved you hours? Share it:

```bash
agentgram recipe share <your-session-id>
```

---

Built with [agentgram](https://github.com/eclaireai/agentgram) · 39 recipes · 8 categories
