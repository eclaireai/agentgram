#!/usr/bin/env npx tsx
/**
 * Registry Curator — "What Do People Actually Need?" Edition.
 *
 * The old 26 recipes were textbook. This is the real world.
 * 40 recipes that developers, DevOps engineers, security teams,
 * business builders, and mobile devs are desperate for right now.
 *
 * New categories (2026 reality):
 *   ai/        — AI & LLM integration  (the #1 burning need)
 *   auth/      — Modern auth (Clerk, Supabase — not DIY JWT)
 *   payments/  — Stripe checkout, subscriptions, webhooks
 *   realtime/  — WebSockets, background jobs, file uploads, email
 *   devops/    — Docker prod, GitHub Actions, Terraform, K8s, Cloudflare
 *   dx/        — Monorepo, UI kit, analytics, search, type-safe APIs
 *   security/  — OWASP API top 10, secrets, scanning
 *   mobile/    — Expo EAS, PWA, Capacitor
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecipeStep {
  action: string;
  target: string;
  description: string;
  pattern?: string;
  expect?: string;
}

interface RecipeDefinition {
  slug: string;
  category: string;
  name: string;
  tagline: string;
  description: string;
  why: string;
  steps: RecipeStep[];
  parameters: Record<string, string>;
  tags: string[];
  stack: string[];
}

// ---------------------------------------------------------------------------
// The 40 Recipes People Actually Need
// ---------------------------------------------------------------------------

const RECIPES: RecipeDefinition[] = [

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: ai  — The #1 burning need of 2026
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'vercel-ai-sdk-chat',
    category: 'ai',
    name: 'AI Streaming Chat (Vercel AI SDK)',
    tagline: 'Add a streaming GPT-4o chatbot to any Next.js app in under 30 minutes',
    description: 'Integrate the Vercel AI SDK to stream AI responses in real time. Includes useChat hook, streaming API route, message history, and abort handling. Works with OpenAI, Anthropic, Google, and Groq.',
    why: 'Streaming is not optional — users abandon AI features that wait 5 seconds before responding. The Vercel AI SDK handles the stream protocol, error recovery, and React state so you don\'t have to invent it yourself.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Detect Next.js version and existing AI dependencies' },
      { action: 'run_command', target: 'npm install ai @ai-sdk/openai', description: 'Install Vercel AI SDK and OpenAI provider' },
      { action: 'create_file', target: 'app/api/chat/route.ts', description: 'Create streaming POST /api/chat route using streamText() with message history support' },
      { action: 'create_file', target: 'components/Chat.tsx', description: 'Create Chat component with useChat hook, message list, input form, and loading indicator' },
      { action: 'create_file', target: 'components/Message.tsx', description: 'Create Message component with role-based styling (user vs assistant), markdown rendering' },
      { action: 'modify_file', target: '.env.local', description: 'Add OPENAI_API_KEY environment variable' },
      { action: 'modify_file', target: 'app/page.tsx', description: 'Add Chat component to the main page' },
      { action: 'run_command', target: 'npm run dev', description: 'Start dev server and verify streaming works end to end', expect: 'Chat streams responses' },
    ],
    parameters: { MODEL: 'gpt-4o', MAX_TOKENS: '1000', SYSTEM_PROMPT: 'You are a helpful assistant.' },
    tags: ['ai', 'llm', 'streaming', 'nextjs', 'openai', 'vercel-ai-sdk', 'chatbot'],
    stack: ['nextjs'],
  },

  {
    slug: 'rag-pgvector',
    category: 'ai',
    name: 'RAG Pipeline with pgvector',
    tagline: 'Production RAG: embed your docs, store in Postgres, semantic search in <100ms',
    description: 'Build a Retrieval-Augmented Generation pipeline using pgvector in PostgreSQL. Embed documents with OpenAI text-embedding-3-small, store vectors in Postgres, and use cosine similarity search to inject context into prompts.',
    why: 'RAG is the correct answer when your AI needs to know things that weren\'t in its training data (your docs, your database, your product). pgvector keeps vectors in your existing Postgres — no new infrastructure, no new vendor, no data leaving your stack.',
    steps: [
      { action: 'run_command', target: 'npm install @ai-sdk/openai drizzle-orm pg', description: 'Install AI SDK, ORM, and Postgres client' },
      { action: 'run_command', target: 'psql -c "CREATE EXTENSION IF NOT EXISTS vector;"', description: 'Enable pgvector extension in your Postgres database' },
      { action: 'create_file', target: 'db/schema/documents.ts', description: 'Create documents table with content TEXT and embedding vector(1536) columns' },
      { action: 'create_file', target: 'lib/embed.ts', description: 'Create embedText() function using text-embedding-3-small, returns Float32Array' },
      { action: 'create_file', target: 'lib/ingest.ts', description: 'Create ingest() that chunks documents, embeds each chunk, and upserts to DB' },
      { action: 'create_file', target: 'lib/search.ts', description: 'Create semanticSearch(query, limit) using cosine similarity operator (<=>)' },
      { action: 'create_file', target: 'app/api/rag/route.ts', description: 'Create RAG API route: search → inject context → stream answer with citations' },
      { action: 'create_file', target: 'scripts/seed-docs.ts', description: 'Create ingestion script that loads markdown files from /docs and ingests them' },
      { action: 'run_command', target: 'npx tsx scripts/seed-docs.ts', description: 'Ingest sample documents and verify embeddings stored', expect: 'N documents ingested' },
    ],
    parameters: { EMBEDDING_MODEL: 'text-embedding-3-small', EMBEDDING_DIMS: '1536', CHUNK_SIZE: '512', TOP_K: '5' },
    tags: ['ai', 'rag', 'pgvector', 'embeddings', 'semantic-search', 'postgresql', 'openai'],
    stack: ['nextjs', 'nodejs', 'postgresql'],
  },

  {
    slug: 'openai-structured-output',
    category: 'ai',
    name: 'AI Structured Output (Tool Calls)',
    tagline: 'Make AI return typed JSON every time — no more parsing hallucinated strings',
    description: 'Use OpenAI function calling / structured outputs with Zod schemas to guarantee typed JSON responses from any model. Includes schema definition, validation, error retry, and streaming with partial object support.',
    why: 'AI that returns unstructured text is a prototype. AI that returns typed, validated JSON is a product. Structured output is the bridge from "demo" to "shipped."',
    steps: [
      { action: 'run_command', target: 'npm install ai @ai-sdk/openai zod', description: 'Install Vercel AI SDK, OpenAI provider, and Zod' },
      { action: 'create_file', target: 'lib/schemas.ts', description: 'Define Zod schemas for your AI outputs (e.g., ProductSchema, SummarySchema)' },
      { action: 'create_file', target: 'lib/ai-extract.ts', description: 'Create extract<T>(prompt, schema) using generateObject() — returns validated TypeScript type' },
      { action: 'create_file', target: 'lib/ai-stream-object.ts', description: 'Create streamExtract<T>(prompt, schema) using streamObject() for progressive UI updates' },
      { action: 'create_file', target: 'app/api/extract/route.ts', description: 'Create extraction API route with input validation and error handling' },
      { action: 'create_file', target: 'tests/ai-extract.test.ts', description: 'Add tests with mocked AI responses verifying schema validation' },
    ],
    parameters: { MODEL: 'gpt-4o', MAX_RETRIES: '3' },
    tags: ['ai', 'structured-output', 'tool-calls', 'zod', 'openai', 'function-calling'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'ollama-local-ai',
    category: 'ai',
    name: 'Local AI with Ollama',
    tagline: 'Run Llama 3, Mistral, and Phi-3 locally — zero API cost, full privacy',
    description: 'Set up Ollama for local AI development. Run open-source models (Llama 3.1, Mistral, CodeLlama) with no API keys, no cost per token, and data never leaving your machine. Integrates with the same Vercel AI SDK interface.',
    why: 'API bills kill prototypes. Privacy requirements kill cloud AI. Ollama gives you production-quality models locally in 3 commands. When you\'re ready for prod, swap the provider — same code, same SDK.',
    steps: [
      { action: 'run_command', target: 'brew install ollama', description: 'Install Ollama (macOS) or download from ollama.com' },
      { action: 'run_command', target: 'ollama pull llama3.1', description: 'Download Llama 3.1 (8B model, ~5GB)' },
      { action: 'run_command', target: 'ollama serve', description: 'Start Ollama server on localhost:11434' },
      { action: 'run_command', target: 'npm install ai @ai-sdk/ollama', description: 'Install Vercel AI SDK with Ollama provider' },
      { action: 'create_file', target: 'lib/local-ai.ts', description: 'Create localAI client pointing to Ollama with fallback to OpenAI when OLLAMA_AVAILABLE env is false' },
      { action: 'modify_file', target: '.env.local', description: 'Add OLLAMA_HOST=http://localhost:11434 and OLLAMA_MODEL=llama3.1' },
      { action: 'create_file', target: 'app/api/chat/route.ts', description: 'Update chat route to use localAI — zero code change needed' },
    ],
    parameters: { OLLAMA_MODEL: 'llama3.1', OLLAMA_HOST: 'http://localhost:11434' },
    tags: ['ai', 'ollama', 'local-ai', 'llama', 'privacy', 'open-source'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'ai-image-generation',
    category: 'ai',
    name: 'AI Image Generation',
    tagline: 'Generate, edit, and vary images with DALL-E 3 and Replicate Flux',
    description: 'Add AI image generation to any app. Covers DALL-E 3 for quality, Replicate Flux for speed, prompt engineering patterns, generated image storage in S3/Cloudflare R2, and a React gallery component.',
    why: 'Image generation is the feature users show their friends. It drives virality. This recipe handles the full pipeline: generate → store → serve — not just the API call.',
    steps: [
      { action: 'run_command', target: 'npm install openai replicate @aws-sdk/client-s3', description: 'Install OpenAI, Replicate, and S3 clients' },
      { action: 'create_file', target: 'lib/image-gen.ts', description: 'Create generateImage(prompt, model) — supports DALL-E 3 and Replicate Flux, returns URL' },
      { action: 'create_file', target: 'lib/image-storage.ts', description: 'Create storeImage(url) that fetches the generated image and uploads to R2/S3 with unique key' },
      { action: 'create_file', target: 'app/api/generate/route.ts', description: 'Create POST /api/generate with rate limiting, prompt moderation, generate, store, return URL' },
      { action: 'create_file', target: 'components/ImageGallery.tsx', description: 'Create gallery with masonry layout, download button, and share link' },
      { action: 'modify_file', target: '.env.local', description: 'Add OPENAI_API_KEY, REPLICATE_API_TOKEN, R2_BUCKET_URL, and R2_ACCESS_KEY' },
    ],
    parameters: { DEFAULT_MODEL: 'dall-e-3', IMAGE_SIZE: '1024x1024', STYLE: 'vivid' },
    tags: ['ai', 'image-generation', 'dall-e', 'replicate', 'flux', 'openai'],
    stack: ['nextjs'],
  },

  {
    slug: 'mcp-server',
    category: 'ai',
    name: 'MCP Server (Model Context Protocol)',
    tagline: 'Give Claude and GPT-4 direct access to your database, APIs, and files',
    description: 'Build a Model Context Protocol server that exposes your app\'s data and actions as tools for AI agents. Includes tool definitions, resource handlers, and connection to Claude Desktop and cursor.',
    why: 'MCP is the USB-C of AI — a standard way to connect any AI to any data source. Instead of copy-pasting context into prompts, your AI agent calls your tools directly. This is the future of AI-native apps.',
    steps: [
      { action: 'run_command', target: 'npm install @modelcontextprotocol/sdk zod', description: 'Install MCP SDK and Zod for schema validation' },
      { action: 'create_file', target: 'mcp/server.ts', description: 'Create MCP Server with name, version, and capabilities declaration' },
      { action: 'create_file', target: 'mcp/tools/index.ts', description: 'Register tools with name, description, inputSchema (Zod), and handler function' },
      { action: 'create_file', target: 'mcp/resources/index.ts', description: 'Register resources (database tables, file contents) as readable context' },
      { action: 'create_file', target: 'mcp/index.ts', description: 'Create entry point connecting server to stdio transport for Claude Desktop' },
      { action: 'modify_file', target: 'package.json', description: 'Add "mcp": "node dist/mcp/index.js" to scripts' },
      { action: 'create_file', target: '.claude/mcp.json', description: 'Register your MCP server in Claude Code settings' },
    ],
    parameters: { SERVER_NAME: 'my-app-mcp', SERVER_VERSION: '1.0.0' },
    tags: ['ai', 'mcp', 'model-context-protocol', 'claude', 'agents', 'tools'],
    stack: ['nodejs', 'nextjs'],
  },

  {
    slug: 'langchain-agent',
    category: 'ai',
    name: 'LangChain Agent with Tools',
    tagline: 'Build an AI agent that can search, browse, and call your APIs autonomously',
    description: 'Create a LangChain agent with custom tools (web search, database queries, API calls). Uses ReAct reasoning loop, conversation memory, and streaming output. Includes LangSmith tracing for debugging.',
    why: 'A single LLM call answers questions. An agent solves problems. The difference is tools and a reasoning loop. This recipe gives you both without having to understand the internals.',
    steps: [
      { action: 'run_command', target: 'npm install langchain @langchain/openai @langchain/community', description: 'Install LangChain and OpenAI integration' },
      { action: 'create_file', target: 'lib/tools/search.ts', description: 'Create web search tool wrapping Tavily or SerpAPI with result formatting' },
      { action: 'create_file', target: 'lib/tools/database.ts', description: 'Create database query tool with safe SQL execution and row limit' },
      { action: 'create_file', target: 'lib/agent.ts', description: 'Create createAgent() with tools, memory (ConversationSummaryMemory), and streaming executor' },
      { action: 'create_file', target: 'app/api/agent/route.ts', description: 'Create agent API route with session management and streaming response' },
      { action: 'modify_file', target: '.env.local', description: 'Add LANGCHAIN_API_KEY, LANGCHAIN_TRACING_V2=true, TAVILY_API_KEY' },
    ],
    parameters: { MODEL: 'gpt-4o', MAX_ITERATIONS: '10', MEMORY_WINDOW: '5' },
    tags: ['ai', 'langchain', 'agents', 'tools', 'openai', 'react-agent'],
    stack: ['nextjs', 'nodejs'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: auth  — Modern auth (not DIY JWT)
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'clerk-nextjs',
    category: 'auth',
    name: 'Clerk Auth for Next.js',
    tagline: 'Complete auth with social login, MFA, and user management in 10 minutes',
    description: 'Add Clerk authentication to a Next.js App Router project. Includes middleware for protected routes, useUser hook, UserButton component, webhooks for user events, and organization support for multi-tenant SaaS.',
    why: 'Building auth from scratch takes weeks and you\'ll get it wrong. Clerk handles OAuth, MFA, session management, bot detection, and compliance. The 10 minutes you spend here saves 3 sprints.',
    steps: [
      { action: 'run_command', target: 'npm install @clerk/nextjs', description: 'Install Clerk Next.js SDK' },
      { action: 'modify_file', target: '.env.local', description: 'Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY from Clerk dashboard' },
      { action: 'create_file', target: 'middleware.ts', description: 'Create Clerk middleware with clerkMiddleware() and route protection rules' },
      { action: 'modify_file', target: 'app/layout.tsx', description: 'Wrap root layout with <ClerkProvider> for global auth context' },
      { action: 'create_file', target: 'app/(auth)/sign-in/[[...sign-in]]/page.tsx', description: 'Add Clerk <SignIn> component with custom redirect URL' },
      { action: 'create_file', target: 'app/(auth)/sign-up/[[...sign-up]]/page.tsx', description: 'Add Clerk <SignUp> component' },
      { action: 'create_file', target: 'app/api/webhooks/clerk/route.ts', description: 'Create webhook handler for user.created, user.updated, user.deleted events — sync to your DB' },
      { action: 'create_file', target: 'lib/auth.ts', description: 'Create getUser() helper for server components and currentUser() for API routes' },
    ],
    parameters: { AFTER_SIGN_IN_URL: '/dashboard', AFTER_SIGN_UP_URL: '/onboarding' },
    tags: ['auth', 'clerk', 'nextjs', 'oauth', 'mfa', 'social-login'],
    stack: ['nextjs'],
  },

  {
    slug: 'supabase-auth',
    category: 'auth',
    name: 'Supabase Auth with Social Login',
    tagline: 'Auth + database + realtime in one — the Firebase alternative that uses Postgres',
    description: 'Set up Supabase Auth with email/password, Google OAuth, and magic links. Includes server-side session handling with SSR helpers, Row Level Security policies, and a user profile table linked to auth.users.',
    why: 'Supabase Auth is free up to 50k users, uses industry-standard OAuth, and the same Postgres database holds your auth and your app data. No user table sync needed — auth.users IS your users table.',
    steps: [
      { action: 'run_command', target: 'npm install @supabase/supabase-js @supabase/ssr', description: 'Install Supabase client and SSR helpers' },
      { action: 'create_file', target: 'lib/supabase/client.ts', description: 'Create browser Supabase client with createBrowserClient()' },
      { action: 'create_file', target: 'lib/supabase/server.ts', description: 'Create server Supabase client with createServerClient() and cookie handling' },
      { action: 'create_file', target: 'middleware.ts', description: 'Create auth middleware that refreshes sessions and protects routes' },
      { action: 'create_file', target: 'app/auth/callback/route.ts', description: 'Create OAuth callback route that exchanges code for session' },
      { action: 'create_file', target: 'supabase/migrations/001_profiles.sql', description: 'Create profiles table + trigger to auto-create profile on user signup + RLS policies' },
      { action: 'modify_file', target: '.env.local', description: 'Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY' },
    ],
    parameters: { REDIRECT_URL: '/dashboard', ENABLE_GOOGLE: 'true', ENABLE_GITHUB: 'true' },
    tags: ['auth', 'supabase', 'oauth', 'magic-link', 'rls', 'postgresql'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'auth-js-v5',
    category: 'auth',
    name: 'Auth.js v5 (Next-Auth)',
    tagline: 'Framework-agnostic auth with 50+ OAuth providers — the open-source standard',
    description: 'Configure Auth.js v5 with multiple OAuth providers (GitHub, Google, Discord), database sessions via Drizzle adapter, and RBAC. Includes protected API routes, server actions auth, and JWT customization.',
    why: 'Auth.js is the most battle-tested open-source auth library for JavaScript. No vendor lock-in, self-hostable, works with any database via adapters. If you want full control over your auth without building from scratch, this is it.',
    steps: [
      { action: 'run_command', target: 'npm install next-auth@beta @auth/drizzle-adapter', description: 'Install Auth.js v5 beta and Drizzle adapter' },
      { action: 'create_file', target: 'auth.ts', description: 'Create Auth.js config with providers, Drizzle adapter, callbacks for JWT and session' },
      { action: 'create_file', target: 'auth.config.ts', description: 'Create edge-compatible config with authorized() callback for middleware use' },
      { action: 'create_file', target: 'middleware.ts', description: 'Create auth middleware using auth.config.ts (edge-safe)' },
      { action: 'create_file', target: 'db/schema/auth.ts', description: 'Create Auth.js Drizzle schema: users, accounts, sessions, verificationTokens tables' },
      { action: 'modify_file', target: '.env.local', description: 'Add AUTH_SECRET, GITHUB_ID, GITHUB_SECRET, GOOGLE_ID, GOOGLE_SECRET' },
      { action: 'create_file', target: 'app/api/auth/[...nextauth]/route.ts', description: 'Create catch-all Auth.js route handler' },
    ],
    parameters: { SESSION_STRATEGY: 'jwt', PROVIDERS: 'github,google' },
    tags: ['auth', 'nextauth', 'auth-js', 'oauth', 'drizzle', 'sessions'],
    stack: ['nextjs'],
  },

  {
    slug: 'api-key-auth',
    category: 'auth',
    name: 'API Key Authentication',
    tagline: 'Secure your API with hashed keys, scopes, rate limits, and usage tracking',
    description: 'Implement API key authentication for developer-facing APIs. Keys are SHA-256 hashed before storage (never store raw keys), support scopes (read/write/admin), have per-key rate limits, and log every request for billing.',
    why: 'If you\'re building an API that other developers consume, OAuth is overkill and JWT is wrong. API keys are the right primitive — stateless, revocable, auditable, and familiar. This recipe gets the security right (hashing, no logging of raw keys).',
    steps: [
      { action: 'create_file', target: 'lib/api-keys.ts', description: 'Create generateApiKey() using crypto.randomBytes(32), hashKey() using SHA-256, prefix with "ag_"' },
      { action: 'create_file', target: 'db/schema/api-keys.ts', description: 'Create api_keys table: id, keyHash, prefix (first 8 chars for lookup), scopes, userId, lastUsed, rateLimit' },
      { action: 'create_file', target: 'middleware/api-auth.ts', description: 'Create validateApiKey(req) middleware: extract Bearer token, hash, lookup by prefix, verify hash, check scopes' },
      { action: 'create_file', target: 'app/api/keys/route.ts', description: 'Create POST /api/keys (create key, return raw key ONCE), GET /api/keys (list keys with last-used), DELETE /api/keys/[id]' },
      { action: 'create_file', target: 'db/schema/api-usage.ts', description: 'Create api_usage table for per-key request logging (for billing and analytics)' },
    ],
    parameters: { KEY_PREFIX: 'ag_', KEY_LENGTH: '32', DEFAULT_RATE_LIMIT: '1000' },
    tags: ['auth', 'api-keys', 'security', 'rate-limiting', 'developer-api'],
    stack: ['nextjs', 'nodejs'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: payments — Revenue
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'stripe-checkout',
    category: 'payments',
    name: 'Stripe Checkout',
    tagline: 'Accept payments in 30 minutes — one-time, saved cards, Apple Pay included',
    description: 'Implement Stripe Checkout for one-time payments. Includes a checkout session API route, success/cancel redirect pages, webhook handler for payment_intent.succeeded, and order fulfillment trigger.',
    why: 'Stripe Checkout offloads PCI compliance, card validation, 3D Secure, and Apple/Google Pay to Stripe. You write 50 lines, not 500. Every hour you spend on custom payment UI is an hour not building your product.',
    steps: [
      { action: 'run_command', target: 'npm install stripe', description: 'Install Stripe Node.js SDK' },
      { action: 'create_file', target: 'lib/stripe.ts', description: 'Create Stripe client singleton with API version pinned to latest stable' },
      { action: 'create_file', target: 'app/api/checkout/route.ts', description: 'Create POST /api/checkout that creates Stripe Checkout Session with success_url and cancel_url' },
      { action: 'create_file', target: 'app/checkout/success/page.tsx', description: 'Create success page that retrieves session and shows order confirmation' },
      { action: 'create_file', target: 'app/api/webhooks/stripe/route.ts', description: 'Create Stripe webhook handler with signature verification, handle payment_intent.succeeded and checkout.session.completed' },
      { action: 'modify_file', target: '.env.local', description: 'Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY' },
      { action: 'run_command', target: 'stripe listen --forward-to localhost:3000/api/webhooks/stripe', description: 'Test webhooks locally with Stripe CLI' },
    ],
    parameters: { CURRENCY: 'usd', SUCCESS_URL: '/checkout/success', CANCEL_URL: '/pricing' },
    tags: ['payments', 'stripe', 'checkout', 'webhooks', 'ecommerce'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'stripe-subscriptions',
    category: 'payments',
    name: 'Stripe Subscriptions (SaaS Billing)',
    tagline: 'Monthly/annual billing, usage limits, plan upgrades, and customer portal',
    description: 'Full SaaS billing with Stripe Subscriptions. Covers plan tiers, trial periods, subscription webhooks (created/updated/cancelled), usage-based billing, and the Stripe Customer Portal for self-serve plan management.',
    why: 'Subscriptions are 90% of SaaS revenue. Getting them wrong (no proration, broken upgrades, missed cancellations) destroys trust and bleeds money. This recipe handles the full lifecycle so you don\'t miss an edge case.',
    steps: [
      { action: 'run_command', target: 'npm install stripe', description: 'Install Stripe SDK' },
      { action: 'create_file', target: 'lib/stripe.ts', description: 'Create Stripe client with types for Plan, Subscription, and Customer' },
      { action: 'create_file', target: 'db/schema/subscriptions.ts', description: 'Create subscriptions table: userId, stripeCustomerId, stripePriceId, status, currentPeriodEnd, cancelAtPeriodEnd' },
      { action: 'create_file', target: 'app/api/billing/subscribe/route.ts', description: 'Create POST /api/billing/subscribe — create customer + subscription, return client secret for payment confirmation' },
      { action: 'create_file', target: 'app/api/billing/portal/route.ts', description: 'Create Stripe Customer Portal session for self-serve plan management' },
      { action: 'create_file', target: 'app/api/webhooks/stripe/route.ts', description: 'Handle customer.subscription.created/updated/deleted and invoice.payment_failed webhooks' },
      { action: 'create_file', target: 'lib/subscription.ts', description: 'Create getSubscription(userId), hasFeature(userId, feature), getPlanLimits(planId) helpers' },
      { action: 'create_file', target: 'middleware/require-plan.ts', description: 'Create middleware to gate features by subscription tier' },
    ],
    parameters: { TRIAL_DAYS: '14', DEFAULT_PLAN: 'starter' },
    tags: ['payments', 'stripe', 'subscriptions', 'saas', 'billing', 'webhooks'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'lemon-squeezy',
    category: 'payments',
    name: 'Lemon Squeezy (Digital Products)',
    tagline: 'Sell digital products globally — Lemon Squeezy handles VAT, tax, and compliance',
    description: 'Integrate Lemon Squeezy for selling digital products, SaaS subscriptions, and licenses. They are the Merchant of Record — they handle VAT, sales tax, and EU compliance. Includes webhook handler and license key activation.',
    why: 'If you sell digital products globally, you legally must collect VAT in each country. Lemon Squeezy makes you a Merchant of Record — they collect and remit tax for you. The alternative is registering in 80 countries.',
    steps: [
      { action: 'run_command', target: 'npm install @lemonsqueezy/lemonsqueezy.js', description: 'Install Lemon Squeezy SDK' },
      { action: 'create_file', target: 'lib/lemon-squeezy.ts', description: 'Create Lemon Squeezy client with configureLemonSqueezy()' },
      { action: 'create_file', target: 'app/api/checkout/route.ts', description: 'Create checkout URL generation with customer email pre-fill and success redirect' },
      { action: 'create_file', target: 'app/api/webhooks/lemon-squeezy/route.ts', description: 'Handle order_created, subscription_created, subscription_cancelled, license_key_created webhooks' },
      { action: 'create_file', target: 'lib/license.ts', description: 'Create activateLicense(key, instanceId), deactivateLicense(), validateLicense() using Lemon Squeezy Licensing API' },
      { action: 'modify_file', target: '.env.local', description: 'Add LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_WEBHOOK_SECRET, NEXT_PUBLIC_STORE_ID' },
    ],
    parameters: { STORE_ID: 'your-store-id' },
    tags: ['payments', 'lemon-squeezy', 'digital-products', 'vat', 'licensing', 'saas'],
    stack: ['nextjs', 'nodejs'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: realtime — WebSockets, jobs, uploads, email
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'uploadthing-files',
    category: 'realtime',
    name: 'File Uploads with UploadThing',
    tagline: 'Type-safe file uploads with progress tracking, validation, and CDN delivery',
    description: 'Add file uploads to a Next.js app using UploadThing. Includes file type validation, size limits, upload progress UI, server-side processing callback, and CDN-delivered URLs. No S3 configuration needed.',
    why: 'Building file uploads correctly (presigned URLs, progress tracking, CDN, virus scanning) takes days. UploadThing wraps it in 20 lines with TypeScript end-to-end. Your users get progress bars; you get validated, CDN-served files.',
    steps: [
      { action: 'run_command', target: 'npm install uploadthing @uploadthing/react', description: 'Install UploadThing and React components' },
      { action: 'create_file', target: 'app/api/uploadthing/core.ts', description: 'Create file router with routes (imageUploader, documentUploader), auth check, file type/size rules, onUploadComplete callback' },
      { action: 'create_file', target: 'app/api/uploadthing/route.ts', description: 'Create Next.js route handler from your file router' },
      { action: 'create_file', target: 'lib/uploadthing.ts', description: 'Export typed client components: UploadButton, UploadDropzone, Uploader' },
      { action: 'create_file', target: 'components/FileUpload.tsx', description: 'Create file upload component with drag-and-drop, progress bar, and preview' },
      { action: 'modify_file', target: '.env.local', description: 'Add UPLOADTHING_SECRET and UPLOADTHING_APP_ID from UploadThing dashboard' },
    ],
    parameters: { MAX_FILE_SIZE: '4MB', ALLOWED_TYPES: 'image/*, application/pdf' },
    tags: ['uploads', 'uploadthing', 'files', 'cdn', 's3', 'nextjs'],
    stack: ['nextjs'],
  },

  {
    slug: 'inngest-background-jobs',
    category: 'realtime',
    name: 'Background Jobs with Inngest',
    tagline: 'Durable async workflows that survive server restarts — no Redis, no Bull, no workers',
    description: 'Implement reliable background job processing with Inngest. Create durable functions that run after HTTP responses, retry automatically on failure, support fan-out workflows, and can be scheduled as crons.',
    why: 'Node.js setTimeout dies when your server restarts. Bull requires Redis. Inngest functions are durable by default — they survive crashes, retries are built-in, and you get a dashboard showing every job\'s history.',
    steps: [
      { action: 'run_command', target: 'npm install inngest', description: 'Install Inngest SDK' },
      { action: 'create_file', target: 'inngest/client.ts', description: 'Create Inngest client with app ID and event key' },
      { action: 'create_file', target: 'inngest/functions/send-welcome-email.ts', description: 'Create sendWelcomeEmail inngest function triggered by user.created event' },
      { action: 'create_file', target: 'inngest/functions/process-upload.ts', description: 'Create processUpload function with multi-step: validate → transform → notify' },
      { action: 'create_file', target: 'app/api/inngest/route.ts', description: 'Create Inngest route handler serving all functions' },
      { action: 'modify_file', target: 'app/api/users/route.ts', description: 'Trigger user.created event after user registration' },
      { action: 'modify_file', target: '.env.local', description: 'Add INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY' },
      { action: 'run_command', target: 'npx inngest-cli@latest dev', description: 'Start Inngest dev server for local testing', expect: 'Inngest dev server running' },
    ],
    parameters: { MAX_RETRIES: '3', CONCURRENCY: '10' },
    tags: ['background-jobs', 'inngest', 'queues', 'async', 'cron', 'workflows'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'resend-email',
    category: 'realtime',
    name: 'Transactional Email with Resend',
    tagline: 'Beautiful HTML emails with React Email — and actually get delivered to inbox',
    description: 'Set up Resend for transactional email with React Email templates. Includes welcome email, password reset, invoice, and notification templates. Custom domain setup for near-100% inbox delivery.',
    why: 'Sendgrid is expensive and over-engineered for transactional email. Resend is built for developers — send with one API call, design with React, track opens and clicks, and get 3000 emails/month free.',
    steps: [
      { action: 'run_command', target: 'npm install resend @react-email/components @react-email/render', description: 'Install Resend and React Email' },
      { action: 'create_file', target: 'emails/WelcomeEmail.tsx', description: 'Create welcome email template with company branding, user name, and CTA button' },
      { action: 'create_file', target: 'emails/PasswordResetEmail.tsx', description: 'Create password reset email with secure reset link and 24-hour expiry notice' },
      { action: 'create_file', target: 'emails/InvoiceEmail.tsx', description: 'Create invoice email with line items table, total, and PDF attachment support' },
      { action: 'create_file', target: 'lib/email.ts', description: 'Create sendEmail(to, template, props) wrapper with error handling and dev-mode preview' },
      { action: 'modify_file', target: '.env.local', description: 'Add RESEND_API_KEY and RESEND_FROM_EMAIL (e.g. noreply@yourdomain.com)' },
    ],
    parameters: { FROM_EMAIL: 'noreply@example.com', REPLY_TO: 'support@example.com' },
    tags: ['email', 'resend', 'react-email', 'transactional', 'notifications'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'supabase-realtime',
    category: 'realtime',
    name: 'Real-Time with Supabase',
    tagline: 'Live cursors, presence, and database change streaming — no WebSocket server needed',
    description: 'Add real-time features using Supabase Realtime: database change subscriptions (INSERT/UPDATE/DELETE events), presence (who\'s online), and broadcast (send arbitrary messages to all connected clients). Zero WebSocket server setup.',
    why: 'Running a WebSocket server for a small app is massively over-engineered. Supabase Realtime is built on Phoenix Channels — battle-tested at massive scale — and you get it free with your Supabase project.',
    steps: [
      { action: 'run_command', target: 'npm install @supabase/supabase-js', description: 'Install Supabase client (realtime is built in)' },
      { action: 'create_file', target: 'hooks/useRealtimeTable.ts', description: 'Create useRealtimeTable(table) hook that subscribes to INSERT/UPDATE/DELETE and returns live rows' },
      { action: 'create_file', target: 'hooks/usePresence.ts', description: 'Create usePresence(channelId) hook tracking online users with enter/leave events' },
      { action: 'create_file', target: 'hooks/useBroadcast.ts', description: 'Create useBroadcast(channel) hook for sending/receiving arbitrary real-time messages' },
      { action: 'create_file', target: 'components/LiveCursors.tsx', description: 'Create live cursor overlay showing other users\' mouse positions' },
      { action: 'create_file', target: 'components/OnlineIndicator.tsx', description: 'Create presence indicator showing online count and avatars' },
    ],
    parameters: { CHANNEL_PREFIX: 'room:', HEARTBEAT_INTERVAL: '30000' },
    tags: ['realtime', 'supabase', 'websockets', 'presence', 'live', 'collaborative'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'bullmq-redis-queues',
    category: 'realtime',
    name: 'Job Queues with BullMQ + Redis',
    tagline: 'High-throughput job queues with retries, concurrency, and delayed jobs',
    description: 'Set up BullMQ for reliable job queue processing. Covers producer/consumer pattern, job concurrency limits, exponential backoff retry, scheduled jobs, job events, and Bull Board UI for monitoring.',
    why: 'If you need to process thousands of jobs per second or need sub-second job latency, BullMQ + Redis outperforms Inngest. This is the choice for high-throughput data pipelines, image processing, and real-time analytics.',
    steps: [
      { action: 'run_command', target: 'npm install bullmq ioredis', description: 'Install BullMQ and Redis client' },
      { action: 'run_command', target: 'docker run -d -p 6379:6379 redis:7-alpine', description: 'Start Redis for local development' },
      { action: 'create_file', target: 'lib/queue/connection.ts', description: 'Create Redis connection for BullMQ with connection pooling' },
      { action: 'create_file', target: 'lib/queue/queues.ts', description: 'Define queues: emailQueue, imageQueue, notificationQueue with default job options' },
      { action: 'create_file', target: 'workers/email.worker.ts', description: 'Create email queue worker with concurrency 5, retry on failure, and completion logging' },
      { action: 'create_file', target: 'workers/index.ts', description: 'Create worker entrypoint that starts all workers' },
      { action: 'create_file', target: 'app/api/admin/queues/route.ts', description: 'Mount Bull Board dashboard at /admin/queues (protected route)' },
    ],
    parameters: { REDIS_URL: 'redis://localhost:6379', CONCURRENCY: '5', MAX_RETRIES: '3' },
    tags: ['queues', 'bullmq', 'redis', 'jobs', 'workers', 'background-processing'],
    stack: ['nodejs', 'nextjs'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: devops — Deploy, scale, and observe
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'docker-production',
    category: 'devops',
    name: 'Production Docker Setup',
    tagline: 'Multi-stage builds, health checks, non-root user, and secrets — done right',
    description: 'Create a production-grade Dockerfile and Docker Compose setup. Multi-stage build (deps → builder → runner), non-root user, health checks, .dockerignore, and docker-compose with Postgres and Redis.',
    why: 'Single-stage Docker builds produce images 3x larger and expose dev dependencies. No health checks means Kubernetes and ECS can\'t detect crashes. Running as root is a security vulnerability. This recipe fixes all three.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Read start script and Node version requirement' },
      { action: 'create_file', target: 'Dockerfile', description: 'Multi-stage: deps (npm ci --frozen-lockfile), builder (npm run build), runner (node:alpine, non-root user, COPY from builder)' },
      { action: 'create_file', target: '.dockerignore', description: 'Exclude: node_modules, .env, .git, .next/cache, coverage, *.test.ts, *.spec.ts' },
      { action: 'create_file', target: 'docker-compose.yml', description: 'Compose with app (healthcheck), postgres:16-alpine (with healthcheck), redis:7-alpine, named volumes' },
      { action: 'create_file', target: 'docker-compose.prod.yml', description: 'Production override: restart: unless-stopped, no bind mounts, resource limits' },
      { action: 'run_command', target: 'docker build -t app:latest --target runner .', description: 'Build production image and verify it works', expect: 'Build succeeds' },
      { action: 'run_command', target: 'docker run --rm app:latest node -e "process.exit(0)"', description: 'Verify image starts cleanly' },
    ],
    parameters: { NODE_VERSION: '22-alpine', PORT: '3000', HEALTHCHECK_PATH: '/api/health' },
    tags: ['docker', 'devops', 'containers', 'production', 'health-checks', 'security'],
    stack: ['nodejs', 'nextjs'],
  },

  {
    slug: 'github-actions-ci',
    category: 'devops',
    name: 'GitHub Actions CI/CD',
    tagline: 'Fast CI with dependency caching, parallel jobs, and automated deploys on merge',
    description: 'Production GitHub Actions workflow for Node.js. Includes npm caching (cuts install from 60s to 5s), parallel test and lint jobs, type checking, and deploy-to-Vercel/Railway on merge to main.',
    why: 'A CI pipeline that takes 10 minutes kills developer velocity. This recipe uses npm caching, job parallelization, and early exits to get feedback in under 2 minutes. The deploy step means every merge to main goes live automatically.',
    steps: [
      { action: 'create_file', target: '.github/workflows/ci.yml', description: 'Create CI workflow: trigger on PR and push to main, runs on ubuntu-latest' },
      { action: 'modify_file', target: '.github/workflows/ci.yml', description: 'Add npm cache step using actions/cache with cache key on package-lock.json hash' },
      { action: 'modify_file', target: '.github/workflows/ci.yml', description: 'Add parallel jobs: typecheck, lint, test (with coverage upload), build' },
      { action: 'create_file', target: '.github/workflows/deploy.yml', description: 'Create deploy workflow triggered on push to main: runs tests then deploys to Vercel' },
      { action: 'create_file', target: '.github/workflows/security.yml', description: 'Add weekly security scan: npm audit, CodeQL analysis, Dependabot alerts' },
    ],
    parameters: { NODE_VERSION: '22', CACHE_KEY: 'node-modules-${{ hashFiles(\'package-lock.json\') }}' },
    tags: ['devops', 'github-actions', 'ci-cd', 'automation', 'deployment', 'caching'],
    stack: ['nodejs', 'nextjs'],
  },

  {
    slug: 'terraform-aws',
    category: 'devops',
    name: 'Terraform AWS Infrastructure',
    tagline: 'VPC, ECS Fargate, RDS Postgres, and ALB — production AWS in code',
    description: 'Define AWS production infrastructure with Terraform. Creates VPC with public/private subnets, ECS Fargate cluster, RDS PostgreSQL (Multi-AZ), Application Load Balancer, ACM certificate, and ECR registry.',
    why: 'Clicking through the AWS console creates infrastructure you can\'t reproduce or audit. Terraform makes infrastructure reproducible, reviewable (git diff), and destroyable. One command to spin up prod, one to tear it down.',
    steps: [
      { action: 'create_file', target: 'infrastructure/main.tf', description: 'Create Terraform root module with AWS provider and required_version constraints' },
      { action: 'create_file', target: 'infrastructure/vpc.tf', description: 'Create VPC module: 2 AZs, public subnets (ALB), private subnets (ECS, RDS), NAT Gateway' },
      { action: 'create_file', target: 'infrastructure/ecs.tf', description: 'Create ECS Fargate cluster, task definition, service with auto-scaling on CPU/memory' },
      { action: 'create_file', target: 'infrastructure/rds.tf', description: 'Create RDS PostgreSQL 16, Multi-AZ, automated backups (7 days), encrypted storage' },
      { action: 'create_file', target: 'infrastructure/alb.tf', description: 'Create ALB with HTTPS listener (ACM cert), HTTP→HTTPS redirect, and target group health checks' },
      { action: 'create_file', target: 'infrastructure/variables.tf', description: 'Define variables: environment, region, app_name, db_instance_class, min/max_capacity' },
      { action: 'create_file', target: 'infrastructure/outputs.tf', description: 'Output: alb_dns, rds_endpoint, ecr_repository_url, ecs_cluster_name' },
      { action: 'run_command', target: 'terraform init && terraform plan', description: 'Initialize Terraform and preview changes', expect: 'Plan: N to add, 0 to change, 0 to destroy' },
    ],
    parameters: { AWS_REGION: 'us-east-1', ENVIRONMENT: 'production', DB_INSTANCE: 'db.t3.medium' },
    tags: ['devops', 'terraform', 'aws', 'ecs', 'rds', 'infrastructure', 'iac'],
    stack: ['nodejs'],
  },

  {
    slug: 'kubernetes-helm',
    category: 'devops',
    name: 'Kubernetes Deployment with Helm',
    tagline: 'Deploy any app to K8s with HPA, rolling updates, and secret management',
    description: 'Create a Helm chart for deploying a Node.js app to Kubernetes. Includes Deployment with resource limits, HorizontalPodAutoscaler, ConfigMap, ExternalSecret (for secrets manager), and Ingress with cert-manager TLS.',
    why: 'Raw Kubernetes YAML is verbose and error-prone. Helm charts are parameterizable, version-controlled, and shareable. This chart handles the production concerns (resource limits, autoscaling, secrets) that raw YAML tutorials skip.',
    steps: [
      { action: 'run_command', target: 'helm create charts/app', description: 'Scaffold a new Helm chart' },
      { action: 'modify_file', target: 'charts/app/values.yaml', description: 'Set image.repository, resources.requests/limits, autoscaling.enabled, ingress.enabled, replicaCount' },
      { action: 'create_file', target: 'charts/app/templates/hpa.yaml', description: 'Create HPA scaling on CPU (70%) and memory (80%) with min 2 / max 10 replicas' },
      { action: 'create_file', target: 'charts/app/templates/externalsecret.yaml', description: 'Create ExternalSecret pulling DATABASE_URL and API keys from AWS Secrets Manager' },
      { action: 'modify_file', target: 'charts/app/templates/deployment.yaml', description: 'Add liveness/readiness probes, security context (non-root), and rollingUpdate strategy' },
      { action: 'run_command', target: 'helm lint charts/app', description: 'Validate chart syntax', expect: '1 chart(s) linted, 0 chart(s) failed' },
    ],
    parameters: { NAMESPACE: 'production', MIN_REPLICAS: '2', MAX_REPLICAS: '10' },
    tags: ['devops', 'kubernetes', 'helm', 'k8s', 'autoscaling', 'containers'],
    stack: ['nodejs'],
  },

  {
    slug: 'cloudflare-workers',
    category: 'devops',
    name: 'Cloudflare Workers + D1',
    tagline: 'Deploy serverless API to 300+ edge locations with SQLite at the edge',
    description: 'Build and deploy a Cloudflare Workers API with D1 (SQLite at the edge), KV storage, and R2 for files. Sub-millisecond cold starts, 0ms latency from your users\' location, and a generous free tier.',
    why: 'Traditional serverless (Lambda) has cold starts and runs in one region. Cloudflare Workers have no cold start and run in 300+ cities worldwide. For global read-heavy APIs, this is 10x faster than a regional server.',
    steps: [
      { action: 'run_command', target: 'npm create cloudflare@latest my-worker -- --type=hello-world', description: 'Scaffold Cloudflare Worker with Wrangler' },
      { action: 'modify_file', target: 'wrangler.toml', description: 'Add D1 database binding, KV namespace binding, and R2 bucket binding' },
      { action: 'run_command', target: 'npx wrangler d1 create my-db', description: 'Create D1 database and copy ID to wrangler.toml' },
      { action: 'create_file', target: 'src/db/schema.sql', description: 'Create D1 schema: users, posts tables with indexes' },
      { action: 'run_command', target: 'npx wrangler d1 execute my-db --local --file=src/db/schema.sql', description: 'Apply schema to local D1' },
      { action: 'create_file', target: 'src/index.ts', description: 'Create Hono.js router with GET/POST routes using D1 bindings for database operations' },
      { action: 'run_command', target: 'npx wrangler dev', description: 'Start local development with D1', expect: 'Ready on http://localhost:8787' },
      { action: 'run_command', target: 'npx wrangler deploy', description: 'Deploy to Cloudflare edge network' },
    ],
    parameters: { WORKER_NAME: 'my-api', D1_DATABASE: 'my-db' },
    tags: ['devops', 'cloudflare', 'edge', 'serverless', 'd1', 'workers'],
    stack: ['nodejs'],
  },

  {
    slug: 'opentelemetry-observability',
    category: 'devops',
    name: 'OpenTelemetry Full Observability',
    tagline: 'Traces, metrics, and logs in one — vendor-neutral observability for any stack',
    description: 'Instrument a Node.js app with OpenTelemetry SDK. Exports traces to Jaeger, metrics to Prometheus, and logs to Grafana Loki. Includes auto-instrumentation for HTTP, database, and custom business spans.',
    why: 'When production breaks at 3am, logs tell you something failed. Traces tell you exactly which service, which query, which line, and how long each step took. OpenTelemetry is the standard — instrument once, use any vendor.',
    steps: [
      { action: 'run_command', target: 'npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http', description: 'Install OpenTelemetry SDK and exporters' },
      { action: 'create_file', target: 'lib/telemetry.ts', description: 'Create NodeSDK with auto-instrumentation, OTLP trace exporter, and Prometheus metrics exporter' },
      { action: 'modify_file', target: 'src/index.ts', description: 'Import telemetry.ts FIRST (before any other imports) to ensure auto-instrumentation' },
      { action: 'create_file', target: 'lib/tracing.ts', description: 'Create trace(name, fn) helper for manual business spans with error recording' },
      { action: 'create_file', target: 'docker-compose.observability.yml', description: 'Add Jaeger, Prometheus, and Grafana to local compose for development' },
      { action: 'create_file', target: 'dashboards/app.json', description: 'Create Grafana dashboard JSON with request rate, p99 latency, error rate, and DB query panels' },
    ],
    parameters: { SERVICE_NAME: 'my-service', OTLP_ENDPOINT: 'http://localhost:4318' },
    tags: ['devops', 'observability', 'opentelemetry', 'tracing', 'metrics', 'grafana'],
    stack: ['nodejs'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: dx — Developer experience
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'turborepo-monorepo',
    category: 'dx',
    name: 'Turborepo Monorepo',
    tagline: 'Web app + mobile + API + shared packages — one repo, 10x faster builds',
    description: 'Set up a Turborepo monorepo with pnpm workspaces. Apps: web (Next.js), api (Hono/Express), mobile (Expo). Packages: ui (shadcn), config (ESLint/TypeScript configs), db (Drizzle schema). Remote caching with Vercel.',
    why: 'Separate repos for web, API, and mobile means copy-pasted code, version mismatches, and no shared types. A monorepo with Turborepo gives you shared TypeScript types across all apps, cached builds (zero rebuild if unchanged), and one PR for cross-app changes.',
    steps: [
      { action: 'run_command', target: 'npx create-turbo@latest my-app --package-manager=pnpm', description: 'Scaffold Turborepo with pnpm workspaces' },
      { action: 'create_file', target: 'packages/ui/package.json', description: 'Create shared UI package with shadcn components exported as named exports' },
      { action: 'create_file', target: 'packages/db/package.json', description: 'Create shared database package with Drizzle schema and migrations' },
      { action: 'create_file', target: 'packages/config-typescript/tsconfig.base.json', description: 'Create shared TypeScript config extended by all apps' },
      { action: 'modify_file', target: 'turbo.json', description: 'Configure pipeline: build depends on ^build, test is always run, dev has persistent: true' },
      { action: 'run_command', target: 'npx turbo login && npx turbo link', description: 'Enable Vercel remote cache — share build artifacts across team' },
    ],
    parameters: { PACKAGE_MANAGER: 'pnpm', REMOTE_CACHE: 'vercel' },
    tags: ['dx', 'turborepo', 'monorepo', 'pnpm', 'workspaces', 'nextjs'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'shadcn-tailwind-v4',
    category: 'dx',
    name: 'shadcn/ui + Tailwind v4',
    tagline: 'The component library that owns no code — beautiful, accessible, yours to modify',
    description: 'Set up shadcn/ui with Tailwind CSS v4 in a Next.js project. Includes dark mode, custom theme tokens, 10 most-used components (Button, Dialog, Sheet, Form, Table, etc.), and Storybook for component development.',
    why: 'shadcn/ui copies components into your codebase — you own the code, you modify it freely, no fighting with library overrides. It\'s the UI kit that doesn\'t fight you. Combined with Tailwind v4\'s native cascade layers, this is the stack for 2026.',
    steps: [
      { action: 'run_command', target: 'npx shadcn@latest init', description: 'Initialize shadcn/ui (selects style, base color, CSS variables)' },
      { action: 'run_command', target: 'npx shadcn@latest add button dialog sheet form table card badge toast', description: 'Add the 10 most-used components' },
      { action: 'create_file', target: 'app/globals.css', description: 'Configure Tailwind v4 @theme block with custom colors, fonts, and spacing' },
      { action: 'create_file', target: 'components/theme-toggle.tsx', description: 'Create dark/light mode toggle using next-themes' },
      { action: 'run_command', target: 'npm install -D @storybook/nextjs', description: 'Add Storybook for component development' },
      { action: 'run_command', target: 'npx storybook@latest init', description: 'Initialize Storybook with Next.js framework' },
    ],
    parameters: { BASE_COLOR: 'slate', STYLE: 'default' },
    tags: ['dx', 'shadcn', 'tailwind', 'ui', 'components', 'dark-mode', 'accessibility'],
    stack: ['nextjs'],
  },

  {
    slug: 'drizzle-postgres',
    category: 'dx',
    name: 'Drizzle ORM + PostgreSQL',
    tagline: 'Type-safe SQL that feels like writing SQL — migrations, relations, zero runtime overhead',
    description: 'Set up Drizzle ORM with PostgreSQL. Define schemas in TypeScript, run type-safe queries, generate and apply migrations. Includes relations, prepared statements, and Drizzle Studio for visual data exploration.',
    why: 'Prisma is a black box — it generates a client you can\'t fully control, with runtime overhead. Drizzle is transparent SQL in TypeScript. No magic, no hidden N+1, and it\'s the fastest ORM for Node.js by benchmark.',
    steps: [
      { action: 'run_command', target: 'npm install drizzle-orm postgres', description: 'Install Drizzle ORM and postgres client' },
      { action: 'run_command', target: 'npm install -D drizzle-kit', description: 'Install Drizzle Kit for migrations' },
      { action: 'create_file', target: 'db/schema/index.ts', description: 'Define tables using pgTable(), column types, and indexes' },
      { action: 'create_file', target: 'db/index.ts', description: 'Create Drizzle client with postgres connection pool, exported as db' },
      { action: 'create_file', target: 'drizzle.config.ts', description: 'Configure schema path, migrations output, and connection string for Drizzle Kit' },
      { action: 'run_command', target: 'npx drizzle-kit generate', description: 'Generate SQL migration from schema diff' },
      { action: 'run_command', target: 'npx drizzle-kit migrate', description: 'Apply migration to database', expect: 'Migrations applied' },
      { action: 'run_command', target: 'npx drizzle-kit studio', description: 'Open Drizzle Studio at https://local.drizzle.studio' },
    ],
    parameters: { DB_URL: 'postgresql://user:password@localhost/mydb' },
    tags: ['dx', 'drizzle', 'orm', 'postgresql', 'typescript', 'sql', 'migrations'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'trpc-v11',
    category: 'dx',
    name: 'tRPC v11 Type-Safe API',
    tagline: 'End-to-end type-safe API — no codegen, no REST, just TypeScript',
    description: 'Set up tRPC v11 with Next.js App Router. Define procedures on the server, call them from the client with full autocomplete and type safety. Includes auth middleware, input validation with Zod, React Query integration.',
    why: 'REST APIs require manual types on both sides that drift out of sync. GraphQL requires codegen. tRPC gives you end-to-end TypeScript types with zero overhead — change a server procedure\'s output and the client immediately shows a type error.',
    steps: [
      { action: 'run_command', target: 'npm install @trpc/server @trpc/client @trpc/react-query @tanstack/react-query zod', description: 'Install tRPC, React Query, and Zod' },
      { action: 'create_file', target: 'server/trpc.ts', description: 'Create tRPC instance with context (auth, db), middleware (isAuthed), and base procedures (publicProcedure, protectedProcedure)' },
      { action: 'create_file', target: 'server/routers/_app.ts', description: 'Create root router merging all sub-routers (users, posts, etc.)' },
      { action: 'create_file', target: 'app/api/trpc/[trpc]/route.ts', description: 'Create tRPC HTTP handler for Next.js App Router' },
      { action: 'create_file', target: 'lib/trpc/client.ts', description: 'Create tRPC React client with React Query provider and batch link' },
      { action: 'create_file', target: 'server/routers/users.ts', description: 'Create example users router with list, byId, create, and update procedures' },
    ],
    parameters: {},
    tags: ['dx', 'trpc', 'typescript', 'api', 'react-query', 'type-safety'],
    stack: ['nextjs'],
  },

  {
    slug: 'posthog-analytics',
    category: 'dx',
    name: 'PostHog Analytics + Feature Flags',
    tagline: 'Event tracking, funnels, session replay, and feature flags — open source',
    description: 'Integrate PostHog for product analytics and feature flags. Track custom events, define funnels, enable session replay, and use feature flags to roll out features to specific user segments. Self-hostable.',
    why: 'Google Analytics tells you page views. PostHog tells you why users churn. Session replay shows you exactly where they got stuck. Feature flags let you ship to 5% of users before 100%. This is the analytics stack that makes products better.',
    steps: [
      { action: 'run_command', target: 'npm install posthog-js posthog-node', description: 'Install PostHog browser SDK and Node.js SDK' },
      { action: 'create_file', target: 'app/providers/PostHogProvider.tsx', description: 'Create PostHog provider component with posthog-js initialization and user identification' },
      { action: 'create_file', target: 'lib/analytics.ts', description: 'Create track(), identify(), setUserProperties(), and page() wrapper functions' },
      { action: 'create_file', target: 'lib/feature-flags.ts', description: 'Create isFeatureEnabled(flag, userId) using posthog-node for server-side flag evaluation' },
      { action: 'create_file', target: 'middleware.ts', description: 'Add Bootstrap data to middleware response for SSR feature flags without waterfall' },
      { action: 'modify_file', target: '.env.local', description: 'Add NEXT_PUBLIC_POSTHOG_KEY and NEXT_PUBLIC_POSTHOG_HOST' },
    ],
    parameters: { POSTHOG_HOST: 'https://app.posthog.com', SESSION_RECORDING: 'true' },
    tags: ['dx', 'analytics', 'posthog', 'feature-flags', 'session-replay', 'events'],
    stack: ['nextjs'],
  },

  {
    slug: 'meilisearch-search',
    category: 'dx',
    name: 'Full-Text Search with Meilisearch',
    tagline: 'Instant search with typo tolerance in <50ms — self-hosted or cloud',
    description: 'Add Meilisearch for lightning-fast, typo-tolerant full-text search. Index your database records, configure searchable/filterable attributes, and build a search UI with InstantSearch React components.',
    why: 'SQL LIKE queries are slow and have no typo tolerance. Elasticsearch requires dedicated DevOps. Meilisearch delivers sub-50ms results with typo correction and relevance ranking out of the box, with a 5-minute setup.',
    steps: [
      { action: 'run_command', target: 'docker run -d -p 7700:7700 getmeili/meilisearch:latest', description: 'Start Meilisearch for local development' },
      { action: 'run_command', target: 'npm install meilisearch react-instantsearch', description: 'Install Meilisearch client and React InstantSearch' },
      { action: 'create_file', target: 'lib/search.ts', description: 'Create Meilisearch client, createIndex(), indexDocuments(), and search() helper' },
      { action: 'create_file', target: 'scripts/index-data.ts', description: 'Create indexing script that fetches records from DB and sends to Meilisearch' },
      { action: 'create_file', target: 'components/SearchBox.tsx', description: 'Create search UI with InstantSearch, hits, pagination, and facet filters' },
      { action: 'create_file', target: 'app/api/search/route.ts', description: 'Create server-side search proxy with authentication and result shaping' },
      { action: 'run_command', target: 'npx tsx scripts/index-data.ts', description: 'Index existing data into Meilisearch', expect: 'N documents indexed' },
    ],
    parameters: { MEILISEARCH_HOST: 'http://localhost:7700', INDEX_NAME: 'products' },
    tags: ['dx', 'search', 'meilisearch', 'full-text-search', 'instant-search'],
    stack: ['nextjs', 'nodejs'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: security — Ship safe
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'owasp-api-top10',
    category: 'security',
    name: 'OWASP API Security Top 10',
    tagline: 'Harden your API against the 10 most exploited vulnerabilities in production',
    description: 'Implement defenses for the OWASP API Security Top 10 (2023). Covers broken object authorization, authentication flaws, unrestricted resource consumption, injection, and security misconfiguration — with code examples for each.',
    why: 'The OWASP API Top 10 are not theoretical — they are the exact vulnerabilities used in real breaches (Optus, Twitter, T-Mobile). This recipe adds 10 targeted defenses in order of exploitability. Each one takes 15 minutes; each skipped one is a liability.',
    steps: [
      { action: 'run_command', target: 'npm install helmet express-rate-limit joi', description: 'Install security middleware' },
      { action: 'create_file', target: 'middleware/security.ts', description: 'Apply helmet() for all security headers (CSP, HSTS, X-Frame-Options, etc.)' },
      { action: 'create_file', target: 'middleware/rate-limit.ts', description: 'Apply rate limiting: 100 req/15min globally, 5 req/15min on /auth routes' },
      { action: 'create_file', target: 'middleware/object-auth.ts', description: 'Create checkOwnership(req, resourceId) middleware for object-level authorization (BOLA fix)' },
      { action: 'create_file', target: 'middleware/input-validation.ts', description: 'Validate all request bodies with Zod/Joi, reject unknown fields (mass assignment fix)' },
      { action: 'create_file', target: 'middleware/query-limits.ts', description: 'Enforce max page size, max depth for nested queries, and request timeout' },
      { action: 'create_file', target: 'lib/safe-query.ts', description: 'Create parameterized query wrapper that prevents SQL injection' },
      { action: 'create_file', target: 'middleware/error-handler.ts', description: 'Create error handler that never leaks stack traces or internal details to API responses' },
    ],
    parameters: { RATE_LIMIT_WINDOW_MS: '900000', RATE_LIMIT_MAX: '100', MAX_PAGE_SIZE: '100' },
    tags: ['security', 'owasp', 'api', 'rate-limiting', 'injection', 'authorization'],
    stack: ['nodejs', 'nextjs'],
  },

  {
    slug: 'secrets-management',
    category: 'security',
    name: 'Secrets Management (Doppler)',
    tagline: 'Zero .env files in production — secrets rotated, audited, and synced everywhere',
    description: 'Eliminate .env files from production using Doppler. Secrets are stored encrypted, access is audited, and they sync automatically to Vercel/AWS/GitHub Actions. Includes secret rotation and the developer local workflow.',
    why: '.env files get committed. They get copied to Slack. They sit in people\'s home directories forever. Doppler gives you a secrets vault with access control, rotation, and audit logs — and the developer experience is better than .env.',
    steps: [
      { action: 'run_command', target: 'brew install dopplerhq/cli/doppler', description: 'Install Doppler CLI' },
      { action: 'run_command', target: 'doppler login', description: 'Authenticate Doppler CLI with your account' },
      { action: 'run_command', target: 'doppler setup', description: 'Link project to Doppler config' },
      { action: 'modify_file', target: 'package.json', description: 'Prefix dev command with "doppler run --": "dev": "doppler run -- next dev"' },
      { action: 'create_file', target: '.github/workflows/deploy.yml', description: 'Inject Doppler secrets into GitHub Actions using DOPPLER_TOKEN secret' },
      { action: 'create_file', target: 'scripts/sync-vercel.sh', description: 'Script to sync Doppler secrets to Vercel environment using doppler secrets download' },
      { action: 'modify_file', target: '.gitignore', description: 'Remove .env from gitignore — you no longer need it. Add .env.backup instead.' },
    ],
    parameters: { DOPPLER_PROJECT: 'my-app', DOPPLER_CONFIG: 'dev' },
    tags: ['security', 'secrets', 'doppler', 'env-management', 'devops'],
    stack: ['nodejs', 'nextjs'],
  },

  {
    slug: 'codeql-security-scanning',
    category: 'security',
    name: 'CodeQL Security Scanning + Dependabot',
    tagline: 'Catch vulnerabilities in your code and dependencies automatically — before they ship',
    description: 'Set up GitHub CodeQL for static security analysis and Dependabot for dependency vulnerability scanning. CodeQL finds XSS, SQL injection, and path traversal in your code. Dependabot auto-PRs vulnerable dependency updates.',
    why: 'Security tools run by humans are run inconsistently. CodeQL runs on every PR and finds vulnerabilities that human review misses. Dependabot catches the Log4Shell-style supply chain attacks automatically. Both are free for public repos.',
    steps: [
      { action: 'create_file', target: '.github/workflows/codeql.yml', description: 'Create CodeQL analysis workflow on push/PR: javascript and typescript languages' },
      { action: 'create_file', target: '.github/dependabot.yml', description: 'Configure Dependabot: npm updates weekly, GitHub Actions updates monthly' },
      { action: 'create_file', target: '.github/workflows/security.yml', description: 'Add npm audit --audit-level=high to CI — fail build on high-severity vulnerabilities' },
      { action: 'create_file', target: '.github/SECURITY.md', description: 'Create security policy: responsible disclosure, contact email, expected response time' },
      { action: 'run_command', target: 'npm audit', description: 'Run initial audit to baseline current vulnerability state', expect: 'N vulnerabilities' },
    ],
    parameters: {},
    tags: ['security', 'codeql', 'dependabot', 'scanning', 'sast', 'supply-chain'],
    stack: ['nodejs', 'nextjs'],
  },

  {
    slug: 'advanced-rate-limiting',
    category: 'security',
    name: 'Advanced Rate Limiting (Upstash)',
    tagline: 'Per-user rate limits with Redis — survives horizontal scaling and serverless',
    description: 'Implement distributed rate limiting using Upstash Redis and the @upstash/ratelimit library. Supports sliding window, fixed window, and token bucket algorithms. Works in Edge Runtime, Vercel Functions, and traditional servers.',
    why: 'express-rate-limit uses in-memory storage — it breaks with multiple server instances and resets on deploy. Upstash Redis persists limits across instances, regions, and deploys. This is the correct implementation for production.',
    steps: [
      { action: 'run_command', target: 'npm install @upstash/ratelimit @upstash/redis', description: 'Install Upstash rate limiter and Redis client' },
      { action: 'create_file', target: 'lib/rate-limit.ts', description: 'Create rateLimiter with sliding window (10 req/10s) and separate limits for auth endpoints (5/60s)' },
      { action: 'create_file', target: 'middleware/rate-limit.ts', description: 'Create rate limiting middleware using limiter.limit(identifier) where identifier is IP or userId' },
      { action: 'modify_file', target: 'middleware.ts', description: 'Apply rate limiting in Next.js middleware before route handling' },
      { action: 'modify_file', target: '.env.local', description: 'Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from Upstash console' },
    ],
    parameters: { REQUESTS_PER_WINDOW: '10', WINDOW_SECONDS: '10', AUTH_MAX: '5' },
    tags: ['security', 'rate-limiting', 'upstash', 'redis', 'ddos', 'edge'],
    stack: ['nextjs', 'nodejs'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: mobile — Apps
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'expo-eas',
    category: 'mobile',
    name: 'React Native with Expo EAS',
    tagline: 'Build iOS and Android from one codebase — OTA updates, no App Store wait',
    description: 'Set up a React Native app with Expo and EAS (Expo Application Services). Get OTA updates (ship without App Store review), cloud builds (no Mac needed for iOS), and preview builds for testing.',
    why: 'React Native without Expo means maintaining Xcode, Android Studio, signing certificates, and build scripts. Expo handles all of it. EAS lets you push JavaScript updates OTA — your users get fixes in minutes, not 2 days of App Store review.',
    steps: [
      { action: 'run_command', target: 'npx create-expo-app@latest my-app --template blank-typescript', description: 'Create new Expo app with TypeScript template' },
      { action: 'run_command', target: 'npm install -g eas-cli && eas login', description: 'Install EAS CLI and authenticate' },
      { action: 'run_command', target: 'eas build:configure', description: 'Configure EAS builds — creates eas.json with development/preview/production profiles' },
      { action: 'run_command', target: 'eas update:configure', description: 'Configure OTA updates — creates update branch per EAS profile' },
      { action: 'create_file', target: 'app/_layout.tsx', description: 'Set up Expo Router with tab and stack navigation, typed routes' },
      { action: 'run_command', target: 'eas build --profile development --platform all', description: 'Build development client for iOS and Android', expect: 'Build submitted' },
      { action: 'run_command', target: 'eas update --branch preview --message "First update"', description: 'Push first OTA update to preview channel' },
    ],
    parameters: { APP_SLUG: 'my-app', BUNDLE_ID: 'com.company.myapp' },
    tags: ['mobile', 'expo', 'react-native', 'ios', 'android', 'ota', 'eas'],
    stack: ['react-native'],
  },

  {
    slug: 'pwa-nextjs',
    category: 'mobile',
    name: 'Progressive Web App with Next.js',
    tagline: 'Install your web app on any device — offline support, push notifications, home screen',
    description: 'Convert a Next.js app into a PWA with offline support, push notifications, home screen installation, and app-like navigation. Uses next-pwa with Workbox service worker strategies.',
    why: 'A PWA is a native-quality app without an App Store. Users install it from the browser, it works offline, and you push updates instantly. For content-heavy or B2B apps, PWAs outperform both web and native in engagement metrics.',
    steps: [
      { action: 'run_command', target: 'npm install @ducanh2912/next-pwa', description: 'Install next-pwa (Workbox-powered, TypeScript compatible)' },
      { action: 'modify_file', target: 'next.config.ts', description: 'Wrap next config with withPWA() — configure caching strategies and workbox options' },
      { action: 'create_file', target: 'public/manifest.json', description: 'Create Web App Manifest: name, icons (192px, 512px), theme_color, display: standalone, start_url' },
      { action: 'modify_file', target: 'app/layout.tsx', description: 'Add <link rel="manifest">, meta theme-color, and apple-touch-icon to document head' },
      { action: 'create_file', target: 'lib/push-notifications.ts', description: 'Create subscribeToPush(), sendPushNotification(), and unsubscribe() using Web Push API' },
      { action: 'create_file', target: 'public/sw-custom.js', description: 'Add custom service worker logic: background sync, offline page, push event handler' },
    ],
    parameters: { APP_NAME: 'My App', THEME_COLOR: '#000000', OFFLINE_PAGE: '/offline' },
    tags: ['mobile', 'pwa', 'nextjs', 'offline', 'push-notifications', 'service-worker'],
    stack: ['nextjs'],
  },

  {
    slug: 'capacitor-mobile',
    category: 'mobile',
    name: 'Web to iOS/Android with Capacitor',
    tagline: 'Ship your existing web app as a native iOS and Android app today',
    description: 'Wrap any existing web app (React, Next.js, Vue) in a native iOS and Android app using Capacitor. Access camera, GPS, biometrics, and native APIs. Submit to App Store and Google Play from your web codebase.',
    why: 'If you already have a web app, Capacitor is the fastest path to the App Store. It\'s not a WebView hack — it\'s the same approach Ionic uses, with direct access to 100+ native APIs. Your web developers become mobile developers.',
    steps: [
      { action: 'run_command', target: 'npm install @capacitor/core @capacitor/cli', description: 'Install Capacitor core and CLI' },
      { action: 'run_command', target: 'npx cap init "My App" "com.company.myapp"', description: 'Initialize Capacitor in your web project' },
      { action: 'run_command', target: 'npm install @capacitor/ios @capacitor/android', description: 'Add iOS and Android platforms' },
      { action: 'run_command', target: 'npm install @capacitor/camera @capacitor/geolocation @capacitor/push-notifications', description: 'Add native plugins for camera, GPS, and push' },
      { action: 'run_command', target: 'npm run build && npx cap sync', description: 'Build web app and sync to native projects' },
      { action: 'run_command', target: 'npx cap open ios', description: 'Open in Xcode for iOS build and App Store submission' },
      { action: 'run_command', target: 'npx cap open android', description: 'Open in Android Studio for Google Play submission' },
    ],
    parameters: { APP_ID: 'com.company.myapp', WEB_DIR: 'out' },
    tags: ['mobile', 'capacitor', 'ios', 'android', 'native', 'cross-platform'],
    stack: ['nextjs', 'nodejs'],
  },

  {
    slug: 'n8n-automation',
    category: 'mobile',
    name: 'n8n Workflow Automation',
    tagline: 'No-code automation for non-tech users — connect 400+ apps without writing code',
    description: 'Deploy and integrate n8n for workflow automation. Create automations that trigger on webhooks, schedule with cron, and connect your app to Slack, email, databases, and 400+ other services. Self-hosted for data privacy.',
    why: 'Non-technical users need to automate without asking developers. n8n is the self-hosted alternative to Zapier — unlimited workflows, no per-task pricing, and your data never leaves your servers. One deployment saves thousands in Zapier costs.',
    steps: [
      { action: 'run_command', target: 'docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n n8nio/n8n', description: 'Start n8n with persistent storage' },
      { action: 'create_file', target: 'n8n/docker-compose.yml', description: 'Create production n8n compose with PostgreSQL backend, SMTP config, and webhook URL' },
      { action: 'create_file', target: 'app/api/webhooks/n8n/route.ts', description: 'Create webhook endpoint that n8n can trigger to start workflows from your app events' },
      { action: 'create_file', target: 'lib/n8n.ts', description: 'Create triggerWorkflow(workflowId, data) function using n8n REST API for app-initiated automations' },
      { action: 'modify_file', target: '.env.local', description: 'Add N8N_BASE_URL, N8N_API_KEY, N8N_WEBHOOK_URL' },
    ],
    parameters: { N8N_PORT: '5678', DB_TYPE: 'postgresdb' },
    tags: ['automation', 'n8n', 'no-code', 'workflows', 'integration', 'non-tech'],
    stack: ['nodejs'],
  },

];

// ---------------------------------------------------------------------------
// README generator for each recipe
// ---------------------------------------------------------------------------

function generateRecipeReadme(def: RecipeDefinition): string {
  const stepLines = def.steps.map((s, i) => {
    const icons: Record<string, string> = {
      find: '🔍',
      run_command: '▶️',
      create_file: '📄',
      modify_file: '✏️',
    };
    const icon = icons[s.action] ?? '•';
    return `${i + 1}. ${icon} **${s.description}**\n   \`${s.target}\`${s.expect ? `\n   *Expected: ${s.expect}*` : ''}`;
  }).join('\n\n');

  const paramLines = Object.entries(def.parameters).map(([k, v]) =>
    `| \`${k}\` | \`${v}\` | — |`
  ).join('\n');

  return `# ${def.name}

> ${def.tagline}

## Why This Exists

${def.why}

## Steps (${def.steps.length} total)

${stepLines}

${Object.keys(def.parameters).length > 0 ? `## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
${paramLines}
` : ''}## Tags

${def.tags.map((t) => `\`${t}\``).join(' · ')}

## Stack

Works with: ${def.stack.join(', ')}

---

*Generated by [agentgram](https://github.com/eclaireai/agentgram) — the AI agent memory layer*
`;
}

// ---------------------------------------------------------------------------
// Index README generator
// ---------------------------------------------------------------------------

function generateIndexReadme(categories: Map<string, RecipeDefinition[]>): string {
  const categoryEmojis: Record<string, string> = {
    ai: '🤖',
    auth: '🔐',
    payments: '💳',
    realtime: '⚡',
    devops: '🚀',
    dx: '✨',
    security: '🛡️',
    mobile: '📱',
  };

  const categoryDescriptions: Record<string, string> = {
    ai: 'AI & LLM integration — chatbots, RAG, structured output, MCP servers',
    auth: 'Modern auth — Clerk, Supabase, Auth.js (not DIY JWT)',
    payments: 'Revenue — Stripe checkout, subscriptions, Lemon Squeezy',
    realtime: 'Live features — file uploads, background jobs, WebSockets, email',
    devops: 'Ship and scale — Docker, GitHub Actions, Terraform, K8s, Cloudflare',
    dx: 'Developer experience — monorepo, UI kit, type-safe APIs, analytics, search',
    security: 'Ship safe — OWASP API top 10, secrets management, automated scanning',
    mobile: 'Apps — Expo React Native, PWA, Capacitor, n8n automation',
  };

  const categoryList = [...categories.entries()].map(([cat, recipes]) => {
    const emoji = categoryEmojis[cat] ?? '📦';
    const desc = categoryDescriptions[cat] ?? '';
    const recipeList = recipes.map((r) =>
      `  - [**${r.name}**](./${cat}/${r.slug}/) — ${r.tagline}`
    ).join('\n');

    return `### ${emoji} ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n${desc}\n\n${recipeList}`;
  }).join('\n\n');

  const total = RECIPES.length;

  return `# agentgram Recipe Registry

> **${total} recipes** for what developers, DevOps, security teams, and business builders actually need in ${new Date().getFullYear()}.

## What is this?

When an AI agent adds Stripe for the 50th time, it shouldn't reinvent the pattern from scratch. These recipes are the exact steps, in the exact order, that work. Distilled from real sessions, organized by burning need.

**Use with agentgram:**

\`\`\`bash
npm install -g agentgram
agentgram recipe search "stripe subscriptions"
agentgram recipe pull stripe-subscriptions
agentgram memory import  # load all recipes into agent memory
\`\`\`

## The ${total} Recipes

${categoryList}

## Structure

Each recipe folder contains:
- **\`recipe.json\`** — machine-readable steps, parameters, and metadata
- **\`README.md\`** — human-readable description, WHY it exists, and step-by-step breakdown

## Contributing

Found a workflow that saved you hours? Share it:

\`\`\`bash
agentgram recipe share <your-session-id>
\`\`\`

---

Built with [agentgram](https://github.com/eclaireai/agentgram) · ${total} recipes · ${categories.size} categories
`;
}

// ---------------------------------------------------------------------------
// Build recipe.json
// ---------------------------------------------------------------------------

function buildRecipeJson(def: RecipeDefinition) {
  const id = def.slug;
  const checksum = Buffer.from(def.name + def.steps.length).toString('hex').slice(0, 16);

  return {
    name: def.name,
    description: def.description,
    sourceSessionId: `curated-${def.slug}`,
    steps: def.steps,
    parameters: def.parameters,
    tags: def.tags,
    version: '2.0.0',
    metadata: {
      id,
      author: 'agentgram',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      downloads: 0,
      rating: 5.0,
      ratingCount: 1,
      sourceAgent: 'curated',
      checksum,
      category: def.category,
      stack: def.stack,
      tagline: def.tagline,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const OUT_DIR = path.resolve('registry');

  // Wipe old registry
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('\n\x1b[1m\x1b[36m');
  console.log('  ╔════════════════════════════════════════════════════════════╗');
  console.log('  ║   agentgram Registry — What Developers Actually Need       ║');
  console.log('  ║   "Real artists ship things people actually want."          ║');
  console.log('  ╚════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  const categories = new Map<string, RecipeDefinition[]>();

  for (const recipe of RECIPES) {
    if (!categories.has(recipe.category)) {
      categories.set(recipe.category, []);
    }
    categories.get(recipe.category)!.push(recipe);
  }

  let count = 0;
  for (const [category, recipes] of categories) {
    const catDir = path.join(OUT_DIR, category);
    fs.mkdirSync(catDir, { recursive: true });

    console.log(`\n  \x1b[1m▸ ${category}\x1b[0m`);

    for (const def of recipes) {
      const recipeDir = path.join(catDir, def.slug);
      fs.mkdirSync(recipeDir, { recursive: true });

      fs.writeFileSync(
        path.join(recipeDir, 'recipe.json'),
        JSON.stringify(buildRecipeJson(def), null, 2),
      );

      fs.writeFileSync(
        path.join(recipeDir, 'README.md'),
        generateRecipeReadme(def),
      );

      console.log(`    \x1b[32m✔\x1b[0m  ${def.slug}  \x1b[90m(${def.steps.length} steps)\x1b[0m`);
      count++;
    }
  }

  // Write index.json
  const indexEntries = RECIPES.map((def) => ({
    id: def.slug,
    name: def.name,
    tagline: def.tagline,
    description: def.description.slice(0, 200),
    author: 'agentgram',
    category: def.category,
    tags: def.tags,
    stack: def.stack,
    sourceAgent: 'curated',
    downloads: 0,
    rating: 5.0,
    createdAt: new Date().toISOString(),
    stepCount: def.steps.length,
  }));

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({
    version: '3',
    updatedAt: new Date().toISOString(),
    totalRecipes: RECIPES.length,
    categories: [...categories.keys()],
    recipes: indexEntries,
  }, null, 2));

  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), generateIndexReadme(categories));

  console.log(`\n\x1b[1m\x1b[32m✅ ${count} recipes generated in registry/\x1b[0m`);
  console.log(`\n  Categories:`);
  for (const [cat, recipes] of categories) {
    console.log(`    ${cat.padEnd(12)} ${recipes.length} recipes`);
  }
  console.log();
}

main().catch(console.error);
