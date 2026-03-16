# Elena - Telegram-based AI Squad Assistant

Elena is a high-performance technical assistant architecture designed for specialized development squads. Built for the Gemini Live Agent Challenge 2026, the system implements a multi-process, asynchronous reasoning engine capable of multimodal interaction, long-term memory retrieval, and autonomous tool execution.

The architecture emphasizes security through stage-gating and transparency via detailed execution logs.

---

## Technical Overview

### Core Functionality
- **Asynchronous Execution Pipeline**: Offloads long-running AI reasoning to background workers to maintain high availability of the webhook entry point.
- **Tiered Memory Management**: Integrates Redis for short-term context, Qdrant for semantic vector retrieval, and PostgreSQL for persistent relational data.
- **Multi-Agent Orchestration**: Utilizes a centralized Manager agent to delegate tasks to specialized agents (Coder, Researcher, Reviewer, Brainstormer, Task) with strict tool-access boundaries.
- **Multimodal Context Processing**: Natively processes images and voice data using Gemini's multimodal capabilities, prioritizing visual evidence ("pixel-truth").
- **Human-in-the-Loop (HITL) Security**: Deterministic checkpointing for sensitive operations, requiring manual authorization via Telegram callback queries.

---

## System Features

- **Heuristic Stage-Gating**: Implements zero-cost message filtering to optimize resource consumption. Includes "Active Listening" which allows the bot to wake up on specific technical keywords even without direct mentions.
- **Autonomous Tool Loop**: Supports multi-turn reasoning cycles (up to 5 iterations) for complex technical problem solving.
- **Onboarding Pipeline**: Automated interview-based registration for new members with founder-approval checkpoints.
- **Identity & Access Control**: Role-based permissions system (Superadmin, Admin, Member, Guest).
- **Visual Grounding**: Native support for multimodal image analysis, prioritizing visual evidence ("pixel-truth").
- **Audit & Tracing**: (Phase 5 Roadmap) Specialized observability for agent reasoning steps and utility traces via Langfuse.

---

## Technical Stack

| Layer | Component | Implementation |
| :--- | :--- | :--- |
| **Framework** | NestJS | Modular Node.js framework (Version 11). |
| **Language** | TypeScript | Type-safe implementation (Version 5). |
| **AI Inference** | Google Gemini | Multimodal LLM (3.1 Flash Lite, 3 Flash, 3.1 Pro) via @google/genai. |
| **Database** | PostgreSQL | Persistent relational storage via Supabase. |
| **Message Broker**| BullMQ | Redis-backed queue system for task distribution. |
| **Short-term Memory**| Redis | Low-latency context storage via Upstash (15-message window). |
| **Long-term Memory** | Qdrant | Vector database for semantic RAG operations. |
| **ORM** | Prisma | Type-safe database client (Version 7). |
| **API Integration** | Grammy | Telegram Bot API framework. |

---

## Project Structure

```text
.
├── cloudbuild.yaml        # CI/CD configuration for Google Cloud
├── docker-compose.yml     # Local orchestration for dev/worker services
├── Dockerfile             # Multi-stage build definition
├── nest-cli.json          # NestJS framework configuration
├── package.json           # Dependency and script definitions
├── prisma
│   └── schema.prisma      # Database schema (Users, Bounties, Audit Logs)
├── scripts
│   └── set-webhook.ts     # Utility to register Telegram webhook
├── src
│   ├── agents             # AI logic and specialist agent definitions
│   │   ├── base.agent.ts
│   │   ├── manager.agent.ts
│   │   ├── filter.agent.ts
│   │   ├── coder.agent.ts
│   │   ├── researcher.agent.ts
│   │   ├── reviewer.agent.ts
│   │   └── brainstorm.agent.ts
│   ├── audit              # Audit log module (Note: Langfuse integration planned for Phase 5)
│   ├── memory             # Tiered memory services (Hot, Warm, Cold)
│   ├── onboarding         # Interview pipeline and founder approval flow
│   ├── personas           # Character injection and profile management
│   ├── queue              # BullMQ processors (Message, HITL, Scheduled)
│   ├── safety             # HITL service and message sanitization
│   ├── scheduled          # Background cron tasks
│   ├── secrets            # Placeholder module (Note: Vault implementation planned for Phase 5)
│   ├── telegram           # Webhook controller and message parsing
│   └── tools              # Agent capability registry and implementations
│       ├── github/
│       ├── search/
│       └── registry.service.ts
└── libs                   # Shared internal libraries
    ├── common             # Core utilities and Gemini wrapper
    ├── config             # Zod-based environment validation
    └── database           # Global Prisma module
```

---

## Installation and Deployment

### Prerequisites
- Node.js 20+
- pnpm
- PostgreSQL (Supabase)
- Redis (Upstash)
- Qdrant Cloud
- Google AI Studio API Key

### Local Setup
1. Clone the repository and install dependencies:
   ```bash
   pnpm install
   ```
2. Configure environment variables in `.env` based on `.env.example`.
3. Initialize the database schema:
   ```bash
   npx prisma db push
   ```
4. Execute the services:
   ```bash
   pnpm run start:dev     # Web Service
   pnpm run start:worker  # Worker Service
   ```

---

## Environment Configuration

Key variables required for system operation:
- `TELEGRAM_BOT_TOKEN`: Bot identification token.
- `TELEGRAM_WEBHOOK_SECRET`: Security token for request validation.
- `PROCESS_TYPE`: Defines service mode (`web` or `worker`).
- `GEMINI_API_KEY`: Google AI inference credentials.
- `DATABASE_URL`: Prisma connection string.

---

## API Architecture

### Health Status
- **Endpoint**: `GET /health`
- **Output**: Returns JSON object with system status and current ISO timestamp.

### Webhook Entry
- **Endpoint**: `POST /webhook`
- **Security**: Validates `X-Telegram-Bot-Api-Secret-Token`.
- **Logic**: Performs atomic deduplication via Redis before task ingestion.

---

## Operational Commands

- `/claim-admin`: Initiates Superadmin registration for the first authorized user.
- `/clear`: Purges the "Hot" memory context for the specific chat session.
- `/confirm_{id}`: Resumes a suspended tool execution (HITL).
- `/cancel_{id}`: Aborts a pending tool execution (HITL).

---

## License

UNLICENSED — All rights reserved.
