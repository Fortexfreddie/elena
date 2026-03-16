# Elena — Telegram-based AI Squad Assistant

Elena is a sophisticated, Telegram-based AI assistant designed specifically for small specialized development teams (squads) working on bounties and startup projects. Built for the **Gemini Live Agent Challenge 2026**, Elena acts as a virtual team member who is warm, sharp, and helpful.

Elena doesn't just respond; she listens to the group's needs, manages shared knowledge, facilitates onboarding of new members, and executes technical tools to assist the team's workflow.

---

## 🌟 Project Overview

### What the project does
Elena monitors Telegram group chats where development squads collaborate. She decides when to intervene based on message content, tags, or direct replies. She can research technical topics, review code, track bounties, manage reminders, and maintain a multi-tiered memory of team interactions.

### Problem it solves
- **Context Loss**: Teams often lose track of decisions and technical details in fast-moving chats.
- **Workflow Friction**: Switching between Telegram, GitHub, and Project Management tools slows down the squad.
- **Member Onboarding**: Bringing a new person into a tight-knit squad is often a high-friction process.
- **AI Hallucination**: Generic chatbots often provide incorrect or ungrounded technical advice.

### Who it is for
Small, 3-5 person development squads working on high-impact projects (e.g., Solana bounties, startup MVPs).

### Key Capabilities
- **Multi-tiered Memory**: Combines Redis (Hot), Qdrant (Warm), and PostgreSQL (Cold) for deep context.
- **Autonomous Tool Loop**: Executes multi-step workflows (up to 5 turns) to solve complex requests.
- **Human-in-the-Loop (HITL)**: Asks for permission before performing sensitive actions.
- **Visual Grounding**: Processes images and voice notes with a "pixel-truth" priority.
- **Secure Onboarding**: Interview-based member registration with founder approval flow.

---

## ✨ Features

- **Heuristic Gatekeeping**: Zero-cost pre-filtering to minimize unnecessary AI processing.
- **Multi-Agent Orchestration**: A Manager agent delegates tasks to specialized sub-agents (Coder, Researcher, Brainstormer, etc.).
- **Multimodal Support**: Understands images (with captions) and voice notes natively.
- **Secure Secret Storage**: AES-256-GCM encrypted vault for user-specific secrets (API keys, etc.).
- **Bounty Tracking**: Direct integration with the squad's bounty database.
- **Identity & Roles**: Tiered hierarchy (Superadmin, Admin, Member, Guest).
- **Audit Logging**: Comprehensive trace logging for observability and debugging.
- **Context Resets**: `/clear` command to wipe recent chat context for a fresh start.

---

## 🛠️ Tech Stack

| Layer | Technology | Why it's used |
| :--- | :--- | :--- |
| **Framework** | **NestJS 11** | Modular, scalable Node.js framework with built-in dependency injection. |
| **Language** | **TypeScript 5** | Static typing for reliability and developer productivity. |
| **Primary AI** | **Gemini 1.5/3 Pro/Flash** | State-of-the-art multimodal reasoning with high context windows via `@google/genai`. |
| **Database** | **Supabase (PostgreSQL)** | Persistent storage for users, bounties, audit logs, and onboarding. |
| **Queue** | **BullMQ + ioredis** | Decouples webhook reception from long-running AI processing for 200 OK reliability. |
| **Hot Memory** | **Upstash Redis** | Ultra-low latency storage for recent chat history (last 15 messages). |
| **Warm Memory**| **Qdrant Cloud** | Vector database for semantic search and long-term retrieval-augmented generation (RAG). |
| **ORM** | **Prisma 7** | Type-safe database client with easy migrations. |
| **Telegram** | **Grammy** | Robust Telegram Bot API framework with auto-retry support. |
| **Observability**| **Langfuse** | Specialized tracing for LLM applications. |
| **Validation** | **Zod / class-validator**| Strict schema validation for environment variables and API payloads. |

---

## 🏗️ Architecture Overview

Elena operates as a **Modular Monolith** deployed as two separate processes sharing the same codebase:

1.  **Web Service**: Fast HTTP server that receives Telegram webhooks, validates them, and pushes tasks into the queue.
2.  **Worker Service**: The "Brain" that consumes queue jobs, assembles memory context, runs the LLM agent loops, and sends responses.

### Data Flow
1.  **Incoming**: Telegram message → Webhook Controller → Deduplication → Heuristic Gate → Reaction (🤔) → BullMQ Job.
2.  **Processing**: Worker → Memory Assembler (Redis+Qdrant+Postgres) → Persona Injector → Manager Agent.
3.  **Execution**: Manager → (Optional Delegate) → Tool Execution (GitHub/Doc Scrape/Search) → HITL Guard (if sensitive).
4.  **Outgoing**: Sanitizer → Outbound Message → Audit Log → Memory Write.

---

## 📂 Folder Structure

```text
/src
  /agents         ← Specialist AI agents (Coder, Researcher, Manager)
  /audit          ← Tracing, Langfuse integration, and audit logging
  /memory         ← Hot (Redis), Warm (Qdrant), and Cold (Postgres) services
  /onboarding     ← AI Interviewer, Founder Approval Flow, and Admin commands
  /personas       ← Persona injection and profile management
  /queue          ← BullMQ processors for messages, HITL, and scheduled jobs
  /safety         ← HITL service, sanitizers, and action checklists
  /scheduled      ← Repeatable background tasks
  /secrets        ← AES-256 encrypted vault for user secrets
  /telegram       ← Webhook controller, message parser, and reply senders
  /tools          ← Tool registry and individual implementations (GitHub, Search, etc.)
/libs
  /common         ← Shared types, utils, and the GeminiService wrapper
  /config         ← Zod-based environment variable validation
  /database       ← Prisma client and global database module
/prisma           ← Database schema and migration files
/scripts          ← Deployment and maintenance scripts (e.g., webhook registration)
```

---

## ⚡ Installation

### Prerequisites
- Node.js 20 LTS
- pnpm
- A Supabase Project (PostgreSQL)
- An Upstash Redis Instance
- A Qdrant Cloud Cluster
- A Google AI Studio API Key (Gemini)

### Step-by-Step Setup

1.  **Clone & Install**:
    ```bash
    pnpm install
    ```

2.  **Environment Setup**:
    ```bash
    cp .env.example .env
    # Fill in the required variables (see Environment Variables section)
    ```

3.  **Database Migration**:
    ```bash
    npx prisma generate
    npx prisma db push
    ```

4.  **Start Development**:
    ```bash
    # Terminal 1: Web Service
    pnpm run start:dev
    
    # Terminal 2: Worker Service
    pnpm run start:worker
    ```

---

## 🔑 Environment Variables

| Variable | Description |
| :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | Used to validate incoming webhook headers. |
| `PROCESS_TYPE` | Either `web` or `worker`. Controls service mode. |
| `SUPABASE_WEB_URL` | Postgres URL for the Web service (PgBouncer recommended). |
| `SUPABASE_WORKER_URL` | Direct Postgres URL for the Worker (Session recommended). |
| `UPSTASH_REDIS_URL` | ioredis-compatible connection URL. |
| `GEMINI_API_KEY` | Your Google API key for Gemini. |
| `SECRET_ENCRYPTION_KEY` | 32-byte hex key for the secrets vault. |
| `QDRANT_URL` / `QDRANT_API_KEY` | Vector DB credentials for long-term memory. |

---

## 🚀 Usage

### Interacting with Elena
- **Mentioning**: Tag her in a group chat (e.g., `@YourBotName how is the Solana integration?`).
- **Replying**: Reply to any of her messages and she will "hear" you.
- **Direct DM**: Elena only responds to DMs from approved members.

### Commands
- `/claim-admin`: The first member to run this becomes the Superadmin.
- `/clear`: Resets the current "Hot" conversation context for the chat.
- `/confirm_{jobId}` / `/cancel_{jobId}`: Confirm/Cancel a proposed tool action (HITL).

---

## 📡 API Endpoints

### `GET /health`
- **Purpose**: System health check for Cloud Run probes.
- **Response**: `{ "status": "ok", "timestamp": "..." }`

### `POST /webhook`
- **Purpose**: Main entry point for Telegram Bot API.
- **Security**: Requires `X-Telegram-Bot-Api-Secret-Token`.
- **Logic**: Validates, parses, and pushes message to queue within < 2s.

---

## 🛠️ Development Workflow

### Adding a New Tool
1.  Create a new file in `src/tools/`.
2.  Implement the `AgentTool` interface.
3.  Register the tool in `src/tools/registry.service.ts`.
4.  Add the tool name to the whitelist of a specific agent in `src/agents/agents.module.ts`.

### Extending an Agent
1.  Specialists inherit from `BaseAgent`.
2.  Update the `systemInstruction` or tool list in the specialist's class.
3.  The `ManagerAgent` automatically learns of new specialists via the `delegate_task` tool.

---

## ☁️ Deployment

Elena is configured for **Google Cloud Run** using the provided `cloudbuild.yaml`.

```bash
# Build & Deploy via GCloud
gcloud builds submit --config cloudbuild.yaml
```

**Note**: The worker service requires `--no-cpu-throttling` to process BullMQ jobs correctly in a serverless environment.

---

## ⚖️ License

UNLICENSED — All rights reserved.
