# Elena — AI Squad Assistant for Telegram

Elena is a production-grade Telegram AI assistant built for small development teams. She lives in your group chat, reads every message, decides when to speak, routes complex tasks to specialist AI agents, executes tools autonomously, and remembers everything — across conversations, across days.

She is not a chatbot. She is a team member.

---

## What Elena Can Do

| Capability | How It Works |
|:---|:---|
| **Conversational AI** | Natural group chat participation with personality — warm, sharp, witty. Responds only when relevant. |
| **Multi-Agent Routing** | Classifies messages and delegates to specialist agents (Coder, Researcher, Reviewer, Brainstormer, Task). |
| **Tool Execution** | Searches the web, fetches GitHub repos, reads logs, manages bounties, sends DMs, sets reminders — autonomously. |
| **Multimodal Understanding** | Processes images, voice notes, videos, and stickers natively via Gemini's multimodal API. |
| **Tiered Memory** | Hot (Redis, 15 messages), Warm (Qdrant vectors, semantic search), Cold (Postgres, user profiles & bounties). |
| **Human-in-the-Loop (HITL)** | Sensitive actions (role changes, approvals) are paused and require `/confirm` from an authorized user. |
| **Onboarding Pipeline** | New users are interviewed by an AI agent, and their application is sent to founders for approval via inline buttons. |
| **Role-Based Access Control** | Superadmin → Admin → Member → Guest hierarchy. Enforced at tool level, HITL level, and command level. |
| **Real-Time Status Messages** | Shows live progress indicators in chat while agents work (e.g., "🔍 Researcher Agent — Searching web..."). |
| **Scheduled Reminders** | Users can ask Elena to remind them (or others) at a specific time. Delivered via BullMQ delayed jobs. |

---

## Architecture at a Glance

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Telegram Servers                              │
└──────────────────────┬───────────────────────────────────────────────┘
                       │ Webhook POST
┌──────────────────────▼───────────────────────────────────────────────┐
│  WEB SERVICE (elena-web)                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ Secret Guard│→ │ Idempotency  │→ │  Heuristic   │→ │  BullMQ   │  │
│  │ (401 check) │  │ Gate (Redis) │  │  Gate (zero  │  │  Enqueue  │  │
│  │             │  │ SETNX+TTL    │  │  cost filter)│  │           │  │
│  └─────────────┘  └──────────────┘  └─────────────┘  └─────┬─────┘  │
└─────────────────────────────────────────────────────────────┼────────┘
                                                              │
┌─────────────────────────────────────────────────────────────▼────────┐
│  WORKER SERVICE (elena-worker)                                       │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Memory   │→ │ Filter     │→ │ Manager    │→ │ Specialist Agent │  │
│  │ Assembler│  │ Agent      │  │ Agent      │  │ (Coder/Research/ │  │
│  │ (3-tier) │  │ (route/    │  │ (orchestr- │  │  Reviewer/Brain/ │  │
│  │          │  │  reply/    │  │  ation +   │  │  Task)           │  │
│  │          │  │  ignore)   │  │  tools)    │  │                  │  │
│  └──────────┘  └────────────┘  └────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                       │                    │                    │
          ┌────────────▼──┐   ┌─────────────▼──┐   ┌────────────▼──┐
          │ Redis (Upstash)│  │ Qdrant Cloud   │   │ PostgreSQL   │
          │ Hot Memory     │  │ Warm Memory    │   │ (Supabase)   │
          │ + Locks + HITL │  │ Semantic Search│   │ Cold Memory  │
          └────────────────┘  └────────────────┘   └──────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|:---|:---|:---|
| **Runtime** | Node.js 20 LTS | Server runtime |
| **Language** | TypeScript 5.x (strict) | Type-safe implementation |
| **Framework** | NestJS 11 | Modular backend framework |
| **AI SDK** | `@google/genai` | Gemini 3 Flash, 3.1 Pro, Flash Lite, Embedding |
| **Database** | PostgreSQL (Supabase) | Users, bounties, sessions, audit logs via Prisma 7 |
| **Queue** | BullMQ + ioredis | Async job processing (messages, HITL, scheduled) |
| **Hot Memory** | Upstash Redis (`@upstash/redis`) | 15-message sliding window, distributed locks, HITL state |
| **Warm Memory** | Qdrant Cloud | Semantic vector search (`gemini-embedding-001`, 768-dim) |
| **Telegram** | Grammy + `@grammyjs/auto-retry` | Outbound API client (no `bot.handleUpdate` — webhook only) |
| **Validation** | Zod + class-validator | Runtime arg validation on all tools + env config |
| **Logging** | Pino via `nestjs-pino` | Structured JSON logs |
| **Deployment** | Google Cloud Run | Two services: `elena-web` (HTTP) + `elena-worker` (BullMQ) |

---

## Project Structure

```
elena/
├── src/
│   ├── main.ts                         # Web server bootstrap (NestJS + Grammy init)
│   ├── worker.ts                       # BullMQ worker bootstrap (separate process)
│   ├── app.module.ts                   # Root module — imports all feature modules
│   ├── health.controller.ts            # GET /health
│   │
│   ├── telegram/                       # Webhook ingestion + outbound messaging
│   │   ├── webhook.controller.ts       #   POST /webhook — full pipeline
│   │   ├── message.parser.ts           #   Raw Telegram Update → ParsedMessage
│   │   ├── heuristic-gate.ts           #   Stage 1 zero-cost pre-filter
│   │   ├── reply.sender.ts             #   Grammy outbound + auto-chunk + auto-retry
│   │   ├── dm.dispatcher.ts            #   Private DM sender + audit logging
│   │   ├── reaction.sender.ts          #   Thinking emoji reaction
│   │   ├── media.service.ts            #   File download (Base64 / File API)
│   │   └── guards/
│   │       └── telegram-secret.guard.ts#   Webhook secret validation (timingSafeEqual)
│   │
│   ├── queue/                          # BullMQ job definitions + processors
│   │   ├── queue.module.ts             #   Registers 3 queues (messages, hitl, scheduled)
│   │   ├── queue.service.ts            #   Job enqueueing with update_id deduplication
│   │   ├── message.processor.ts        #   Main message lifecycle (concurrency: 10)
│   │   ├── hitl.processor.ts           #   HITL confirm/cancel with atomic consume
│   │   └── job.types.ts                #   MessageJob, HITLResumeJob, queue names
│   │
│   ├── agents/                         # AI agent definitions
│   │   ├── base.agent.ts               #   Abstract agent with tool loop (max 5 calls)
│   │   ├── filter.agent.ts             #   Stage 2 router (Flash Lite)
│   │   ├── manager.agent.ts            #   Orchestrator + direct tool access (Flash)
│   │   ├── coder.agent.ts              #   Code analysis specialist (Pro)
│   │   ├── researcher.agent.ts         #   Web research specialist (Flash)
│   │   ├── reviewer.agent.ts           #   Code review specialist (Pro)
│   │   ├── brainstorm.agent.ts         #   Ideation specialist (Pro, high thinking)
│   │   ├── task.agent.ts               #   Bounty + reminder management (Flash)
│   │   ├── onboarding.agent.ts         #   Interview flow (Flash) — NOT called by Manager
│   │   ├── personas.injector.ts        #   System prompt builder + sanitizeForPrompt()
│   │   └── status.builder.ts           #   Real-time status message formatter
│   │
│   ├── memory/                         # Tiered memory services
│   │   ├── hot.memory.service.ts       #   Redis sliding window (15 msgs, 2h TTL)
│   │   ├── warm.memory.service.ts      #   Qdrant semantic search + store
│   │   ├── cold.memory.service.ts      #   Postgres reads (profiles, bounties)
│   │   └── assembler.service.ts        #   Combines all 3 tiers → AssembledContext
│   │
│   ├── tools/                          # Tool registry + implementations
│   │   ├── registry.service.ts         #   Central tool registration + lookup
│   │   ├── executor.service.ts         #   Execution wrapper (HITL, truncation, logging)
│   │   ├── base.tool.ts                #   AgentTool interface
│   │   ├── web-search.tool.ts          #   Serper API search (with retry)
│   │   ├── github-fetch.tool.ts        #   GitHub API via Octokit (with retry)
│   │   ├── log-monitor.tool.ts         #   System log reader (sanitized output)
│   │   ├── doc-scraper.tool.ts         #   URL content scraper
│   │   ├── memory-search.tool.ts       #   Qdrant warm memory query
│   │   ├── send-dm.tool.ts             #   Private Telegram DM
│   │   ├── send-reminder.tool.ts       #   Scheduled reminder creation
│   │   ├── bounty-update.tool.ts       #   Bounty CRUD operations
│   │   ├── delegate-task.tool.ts       #   Manager → specialist delegation
│   │   ├── approve-user.tool.ts        #   Onboarding approval (HITL)
│   │   ├── update-user-profile.tool.ts #   Profile/role updates (HITL)
│   │   ├── save-interview.tool.ts      #   Onboarding data persistence
│   │   └── run-code.tool.ts            #   Code execution (stub — not yet implemented)
│   │
│   ├── onboarding/                     # New user interview pipeline
│   │   ├── detector.service.ts         #   Recognition state: known/unknown/pending
│   │   ├── interviewer.service.ts      #   AI-driven interview with distributed lock
│   │   ├── approver.service.ts         #   Founder notification with inline buttons
│   │   └── claim-admin.command.ts      #   /claim-admin bootstrap command
│   │
│   ├── personas/                       # Profile management
│   │   └── profile-builder.service.ts  #   Onboarding finalization + rejection
│   │
│   ├── scheduled/                      # Background scheduled tasks
│   │   └── reminder-delivery.handler.ts#   Reminder delivery via BullMQ delayed jobs
│   │
│   ├── audit/                          # Audit log module
│   ├── safety/                         # HITL service + message sanitization
│   └── secrets/                        # Secret vault (Phase 5)
│
├── libs/                               # Shared internal libraries
│   ├── common/                         #   Gemini wrapper, types, utilities
│   │   └── src/
│   │       ├── gemini/                 #     GeminiService, constants, module
│   │       ├── types/                  #     AgentContext, ParsedMessage, errors
│   │       └── utils/                  #     chunk.ts, sleep.ts, retry.ts
│   ├── config/                         #   Zod env validation
│   └── database/                       #   Global PrismaModule + PrismaService
│
├── prisma/
│   └── schema.prisma                   # DB schema (User, Bounty, OnboardingSession, AuditLog, Reminder)
├── scripts/
│   └── set-webhook.ts                  # Telegram webhook registration utility
├── Dockerfile                          # Multi-stage Cloud Run build
├── cloudbuild.yaml                     # Google Cloud Build CI/CD
├── docker-compose.yml                  # Local dev orchestration
└── package.json
```

---

## Installation

### Prerequisites
- Node.js 20+, pnpm
- PostgreSQL (Supabase), Redis (Upstash), Qdrant Cloud
- Google AI Studio API Key, Telegram Bot Token, Serper API Key

### Setup
```bash
pnpm install
cp .env.example .env          # Fill in your keys
npx prisma db push            # Initialize database schema
```

### Running Locally
```bash
# Terminal 1 — Web service (receives webhooks)
pnpm run start:dev

# Terminal 2 — Worker service (processes messages)
pnpm run start:worker

# Terminal 3 — Expose local webhook (dev only)
npx ngrok http --url=your-subdomain.ngrok-free.dev 3003
```

### Environment Variables

| Variable | Description |
|:---|:---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook request validation |
| `PROCESS_TYPE` | `web` or `worker` — determines service mode |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `DATABASE_URL` | PostgreSQL connection string (Supabase) |
| `DIRECT_URL` | Direct Postgres URL (for Prisma migrations) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `REDIS_URL` | `rediss://` URL for BullMQ (ioredis) |
| `QDRANT_URL` | Qdrant Cloud cluster URL |
| `QDRANT_API_KEY` | Qdrant Cloud API key |
| `SERPER_API_KEY` | Serper.dev search API key |
| `GITHUB_PAT` | GitHub Personal Access Token (read-only) |

---

## Telegram Commands

| Command | Who Can Use | What It Does |
|:---|:---|:---|
| `/claim-admin` | First user only | Bootstraps the initial Superadmin account |
| `/clear` | Admin, Superadmin | Wipes hot memory for the current chat |
| `/confirm_{id}` | Original requester, Admin, Superadmin | Approves a pending HITL action |
| `/cancel_{id}` | Original requester, Admin, Superadmin | Cancels a pending HITL action |

---

## API Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/health` | Returns `{ status: "ok", timestamp: "..." }` |
| `POST` | `/webhook` | Telegram webhook entry — guarded by `TelegramSecretGuard` |

---

## Current Phase: 4 (Security Hardened)

All Critical, High, Medium, Low, and Info security findings from the production readiness audit have been addressed. See `DEEPDIVE.md` for the full security model.

**Phase 5 (Planned):** Langfuse observability, encrypted secret vault, parallel tool execution, advanced rate limiting.

---

## License

UNLICENSED — All rights reserved.
