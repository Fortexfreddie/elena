# Elena — AI Squad Assistant

## What Is Elena

Elena is the AI backend powering The Chatter Project's internal Telegram workspace. She operates as a permanent teammate in your group chat and via DM. When a squad member asks a question, requests code, needs research, wants a bounty updated, or needs a reminder set, Elena routes the request to the correct specialist AI agent, executes it with real tools, and replies in-thread. She is built on NestJS, powered by Google Gemini, and runs on Google Cloud Run.

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- PostgreSQL via Supabase (two connection URLs required)
- Upstash Redis (REST URL + ioredis URL)
- Qdrant Cloud account (vector DB)
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd elena
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in every variable. See **Environment Variables** below for explanations.

### 3. Push Database Schema

```bash
pnpm prisma db push
```

> This applies the schema to your Supabase database. Run it once on first boot, after that only on schema changes.

### 4. Register Webhook with Telegram

After deploying (or using ngrok locally), register Elena's endpoint:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://<YOUR_URL>/webhook" \
  -d "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>"
```

The `secret_token` must match `TELEGRAM_WEBHOOK_SECRET` in your `.env`.

### 5. Start Locally

You need two processes running simultaneously. Open two terminals:

```bash
# Terminal 1: API server (handles webhooks)
pnpm run start:dev

# Terminal 2: BullMQ worker (processes messages)
pnpm run start:worker
```

Elena is live when you see `Bot ID resolved: <id>` in the web logs.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | Yes | Port the HTTP server listens on (Cloud Run auto-sets via `$PORT`) |
| `NODE_ENV` | Yes | `development` or `production` |
| `PROCESS_TYPE` | Yes | `web` (HTTP server) or `worker` (BullMQ consumer) |
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Random string used to verify Telegram's webhook header. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `WEBHOOK_BASE_URL` | Yes | Public base URL of your server (e.g. `https://my-bot.loca.lt`) — do NOT include `/webhook` |
| `SUPABASE_WEB_URL` | Yes | Supabase Transaction Pooler URL (port 6543) — for web instances |
| `SUPABASE_WORKER_URL` | Yes | Supabase Direct URL (port 5432) — for the long-running worker |
| `SUPABASE_DATABASE_URL` | Yes | Used by `prisma db push` and `prisma migrate` CLI |
| `UPSTASH_REDIS_URL` | Yes | Full Redis URL (`rediss://`) for BullMQ via ioredis |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash REST URL for hot memory and dedup gate |
| `UPSTASH_REDIS_TOKEN` | Yes | Upstash REST API token |
| `QDRANT_URL` | Yes | Qdrant Cloud cluster URL |
| `QDRANT_API_KEY` | Yes | Qdrant Cloud API key |
| `QDRANT_COLLECTION` | Yes | Collection name for Elena's embeddings (default: `elena-memory`) |
| `GEMINI_API_KEY` | Yes | Google AI Studio API key |
| `SECRET_ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM secret encryption. Generate: `openssl rand -hex 32` |
| `SERPER_API_KEY` | Yes | Serper.dev API key for web search |
| `JINA_API_KEY` | No | Jina Reader API key for doc scraping (optional; anonymous without it) |
| `GITHUB_TOKEN` | No | GitHub fine-grained PAT with read-only Contents scope for the `github_fetch` tool |
| `GCP_PROJECT_ID` | No | GCP project ID for Cloud Run deployment |
| `LANGFUSE_PUBLIC_KEY` | No | Langfuse observability public key |
| `LANGFUSE_SECRET_KEY` | No | Langfuse observability secret key |
| `LANGFUSE_BASE_URL` | No | Langfuse endpoint (default: `https://cloud.langfuse.com`) |
| `LOG_FILE_PATH` | No | Path to error.log file read by the `log_monitor` tool (default: `error.log`) |
| `NGROK_AUTHTOKEN` | No | Ngrok auth token for local tunneling via Docker Compose |
| `NGROK_DOMAIN` | No | Raw ngrok domain (no `https://`) for local testing |

---

## Commands Reference

All commands are processed in the webhook controller before hitting the AI pipeline. They are exact string matches (case-insensitive).

> **Role management (promote/demote) is NOT a slash command.** There is no `/promote` or `/demote`. You tell Elena in plain English — e.g. *"promote @mike to admin"* or *"demote @john to member"* — and the TaskAgent handles it via the `update_user_profile` tool (HITL-gated, requires `/confirm_`). See [Role Management](#role-management) below.

### `/claim-admin`

**Who can use it:** Anyone (first-time setup only for superadmin) or Approved Members (for admin)

**What it does:**
- If no superadmin exists in the database: Promotes the caller to Superadmin + Founding Member (atomic transaction). This is the bootstrapping command for first deployment.
- If a superadmin already exists AND the caller is an approved member AND fewer than 2 admins exist: Promotes the caller to Admin.
- If a superadmin already exists but the caller is NOT an approved member: Rejects the request.
- If admin capacity is full (2 admins): Rejects the request.

**Example outputs:**
```
✅ Access Granted. You are now the Superadmin and Founding Member of Elena.
✅ Access Granted. You have been promoted to Admin.
❌ Access Denied. You must be an approved member of the squad to claim admin status.
❌ Admin capacity reached. All spots are filled.
⚠️ You already have administrative privileges.
```

---

### `/secret LABEL VALUE [expires:DAYS]`

**Who can use it:** Members, admins, superadmins (not guests). **DM only.**

**What it does:** Stores an encrypted secret in the vault. The original message is immediately deleted from the chat. A confirmation is delivered via DM, never in-group.

**Format:**
```
/secret GITHUB_PAT ghp_abc123xyz
/secret API_KEY my_super_secret expires:30
```

**What happens on error:**
- If used in a group chat: `⚠️ For security, you can only store secrets via DM with Elena.`
- If fewer than 3 parts: `⚠️ Usage: /secret LABEL VALUE or /secret LABEL VALUE expires:30`
- If the user is a guest: silently ignored

**Example DM confirmation:**
```
🔐 Secret GITHUB_PAT stored securely at 14:23 (expires 4/19/2026). The message has been deleted from the chat.
```

---

### `/secrets`

**Who can use it:** Members, admins, superadmins (not guests). Works in DM or group.

**What it does:** Lists the labels of all secrets the caller owns. Values are **never** shown.

**Example output (delivered to your DM):**
```
🔐 Your Secrets (labels only — values never shown):

• GITHUB_PAT (expires 4/19/2026)
• SERPER_KEY
```

If no secrets: `🔐 You have no stored secrets.`

---

### `/clear`

**Who can use it:** Admins and superadmins only. Silently ignored for others.

**What it does:** Deletes Elena's hot memory (Redis) for the current chat. Resets conversational context to zero.

**Example output:**
```
🗑️ Elena's hot memory cleared. Context reset to Day 1.
```

---

### `/confirm_JOBID`

**Who can use it:** The original requester OR any admin/superadmin.

**What it does:** Confirms a pending HITL (Human-in-the-Loop) action. The `JOBID` is provided by Elena in the proposal message. Triggers the `HitlProcessor` to execute the suspended tool. Expires after 5 minutes.

**Format:** `/confirm_chatId:nonce` (exact ID is shown in Elena's proposal)

**What happens on error:**
- Unauthorized user: silently ignored
- Expired (>5 min): `⚠️ This confirmation request has expired (5m limit).`
- Already confirmed: `⚠️ This action was already executed.`

---

### `/cancel_JOBID`

**Who can use it:** The original requester OR any admin/superadmin.

**What it does:** Cancels a pending HITL action. The `JOBID` is provided by Elena in the proposal message.

**Example output:**
```
❌ Action cancelled.
```

---

## Specialist Agents

Elena routes messages to one of six specialist agents. The FilterAgent makes the routing decision using `gemini-3.1-flash-lite-preview`.

### FilterAgent

Not a specialist — this is the Stage 2 router. It receives every message that passes the heuristic gate and returns one of: `ignore`, `reply` (direct answer), or `route` (to a specialist).

**Model:** `gemini-3.1-flash-lite-preview`

---

### ManagerAgent

**Triggers:** DM messages, commands, anything that needs coordination or direct answers. When Filter routes to `manager`, the ManagerAgent runs its own reasoning loop. For all other routes (`coder`, `researcher`, etc.), the Manager immediately bypasses itself and invokes the specialist directly.

**What it does:** Coordinates, answers from memory, delegates to specialists via `delegate_task`, or calls tools directly.

**Tools available:** `delegate_task`, `send_dm`, `send_reminder`, `log_monitor`, `update_user_profile`, `approve_user`, `memory_search`, `web_search`, `bounty_update`, `github_fetch`, `doc_scraper`

**Model:** `gemini-3-flash-preview` (Flash)

**Example prompt:** *"elena what's the status on the bounties today?"*

---

### CoderAgent

**Triggers:** Code writing, debugging, function explanations, error diagnosis, code review requests.

**What it does:** Writes and debugs code. Checks memory first, then searches the web or fetches docs if needed. Always provides code in markdown code blocks.

**Tools:** `memory_search`, `github_fetch`, `web_search`, `doc_scraper`, `log_monitor`

**Model:** `gemini-3.1-pro-preview` (Pro)

**Tool budget:** Max 5 calls

**Example prompt:** *"elena write me a NestJS guard that validates a HMAC signature"*

---

### ReviewerAgent

**Triggers:** Code review requests, security audits, PR reviews.

**What it does:** Reviews code for security issues, correctness, architecture, and best practices. Gives specific line-level feedback with fixes.

**Tools:** `github_fetch`, `memory_search`, `web_search`, `doc_scraper`

**Model:** `gemini-3.1-pro-preview` (Pro)

**Tool budget:** Max 5 calls

**Example prompt:** *"elena review this Prisma transaction, is there a race condition?"*

---

### ResearcherAgent

**Triggers:** Factual questions, "what is X", "how does Y work", pricing/version queries, news searches.

**What it does:** Searches the web via Serper, scrapes docs via Jina for full content when snippets aren't enough. Never reports prices or versions from snippets alone.

**Tools:** `web_search`, `doc_scraper`, `memory_search`, `log_monitor`

**Model:** `gemini-3-flash-preview` (Flash)

**Tool budget:** Max 5 calls

**Example prompt:** *"elena what's the current pricing for Qdrant Cloud?"*

---

### BrainstormAgent

**Triggers:** Architecture discussions, "think through X", exploring approaches, design trade-offs.

**What it does:** Challenges assumptions, proposes unconsidered approaches, plays devil's advocate. Gives 2–3 concrete directions with explicit trade-offs.

**Tools:** `memory_search`, `web_search`, `doc_scraper`

**Model:** `gemini-3.1-pro-preview` (Pro)

**Tool budget:** Max 3 calls

**Example prompt:** *"elena should we use BullMQ or Inngest for the job queue?"*

---

### TaskAgent

**Triggers:** Bounty management, reminder setting, sending DMs, approving users, role changes, log queries.

**What it does:** Executes administrative actions — creates/updates bounties (HITL-gated), schedules reminders, sends DMs (HITL-gated, admin-only), promotes/demotes users (HITL-gated).

**Tools:** `bounty_update`, `send_reminder`, `memory_search`, `send_dm`, `log_monitor`, `approve_user`, `update_user_profile`

**Model:** `gemini-3-flash-preview` (Flash)

**Example prompts:**
- *"elena remind me in 30 minutes to push the build"*
- *"elena update bounty abc123 to in_progress"*
- *"elena approve @savvy_frank"*
- *"elena promote @mike to admin"*
- *"elena demote @john back to member"*
- *"elena kick @spammer — set them to guest"*

---

### OnboardingAgent

**Triggers:** Not triggered by the filter pipeline. Handles DM messages from users whose `onboardingStatus` is not `approved`.

**What it does:** Conducts a 3–5 message intake interview to collect name, role, and preferred work style. Calls the `save_interview` tool when complete, which notifies founders.

---

## Tools Reference

| Tool | Requires HITL | Description |
|---|---|---|
| `web_search` | No | Searches the web via Serper.dev. Returns up to 8 organic results. |
| `doc_scraper` | No | Fetches a URL and returns its content as Markdown (via Jina Reader). Blocks localhost/internal IPs. |
| `github_fetch` | No | Reads GitHub repos, issues, or file contents via Octokit. Requires `GITHUB_TOKEN`. |
| `memory_search` | No | Semantic search over Qdrant warm memory. Automatic tool (not user-triggered directly); used by agents. |
| `log_monitor` | No | Reads the last 50-100 lines of `error.log`. Sanitizes tokens and credentials before returning. Triggered by phrases like "system logs" via TaskAgent. |
| `run_code` | **Yes** | Proposes code execution in a sandbox. *Currently returns a stub error upon confirmation (sandbox coming in Phase 5).* |
| `send_reminder` | No | Schedules a reminder into BullMQ (`elena-scheduled` queue). Delivers to chat or DM at the scheduled time. |
| `send_dm` | **Yes** | Sends a private DM to a user. Admin/superadmin only. Requires `/confirm_` before execution. |
| `bounty_update` | **Yes** | Creates, updates, or lists bounties in Postgres. Requires `/confirm_` before execution. |
| `approve_user` | **Yes** | Approves a pending onboarding application. Founders/admins only. Requires `/confirm_` before execution. |
| `update_user_profile` | **Yes** | Promotes, demotes, or updates a user's role/name/persona. Requires `/confirm_` before execution. |
| `delegate_task` | No | Used internally by ManagerAgent to transfer control to a specialist. Not visible to users. |

**HITL-gated tools:** When Elena calls a HITL-gated tool, execution suspends immediately. Elena sends a proposal message to the chat with `/confirm_JOBID` and `/cancel_JOBID` instructions. The action is stored in Redis with a 5-minute TTL. On `/confirm_`, the `HitlProcessor` executes the tool and reports results.

---

## Memory System

Elena has three memory tiers that are assembled together before every agent call.

### Hot Memory (Redis, 2 hours)

- **What:** Last 15 messages (user + Elena) from the current chat
- **Where:** Upstash Redis, key `hot:{chatId}`
- **TTL:** 2 hours from last write
- **Sort:** Sorted by `telegramDate`, then `updateId` for correct ordering
- **Race condition protection:** Distributed lock (`hot:lock:{chatId}`, 5s TTL, SETNX) prevents concurrent writes from corrupting the list
- **Cleared by:** `/clear` command (admin only)

### Warm Memory (Qdrant, persistent)

- **What:** Conversation pairs (user message + Elena reply) stored as 768-dimensional embeddings
- **Where:** Qdrant Cloud, collection `elena-memory` (Cosine distance)
- **Embedding model:** `gemini-embedding-001` at 768 dimensions (MRL)
- **Access control:** Filter on `accessLevel` (`public` or `private`) and `userId`. A user only sees their own private entries.
- **When stored:** After every reply (both filter-direct replies and agent replies)
- **Used for:** `memory_search` tool and automatic context injection via `AssemblerService`

### Cold Memory (Postgres — read-only by agents)

- **What:** User profiles, active bounties, onboarding status
- **Where:** Supabase PostgreSQL via Prisma
- **Fetched fresh on every request** by `ColdMemoryService.getUserProfile()` and `getActiveBounties()`
- **Not writable by agents directly** — agents use tools like `bounty_update` which write via Prisma

### AssemblerService

Runs before every agent call. Executes three lookups in parallel:
1. `HotMemoryService.getHistory(chatId)` → recent messages
2. `ColdMemoryService.getUserProfile(telegramId)` → user role and persona
3. `WarmMemoryService.search(query, telegramId)` → semantic context (query built from last 3 hot messages)

---

## Onboarding Flow

### Group-First Requirement

Unknown users (not in the database) who send DMs to Elena are silently dropped. A security alert is sent to superadmins. Unknown users must appear in the group chat first, where they are automatically registered as `guest` role.

### Interview Flow

When a user who is not `approved` sends any message (DM or group), the `MessageProcessor` routes them to the `InterviewerService` instead of the normal AI pipeline.

1. **Session created:** An `OnboardingSession` (status `in_progress`) is created in Postgres.
2. **Interview conducted:** The `OnboardingAgent` runs — conversational, one question at a time, collects name, role, and work style.
3. **`save_interview` called:** When the agent has enough info, it calls the `save_interview` tool.
4. **Founders notified:** `ApproverService` sends a DM to every founding member with the applicant's details and inline keyboard buttons: `✅ Approve` / `❌ Deny`.
5. **User waits:** User's `onboardingStatus` remains `pending`.

### Approval

Founders click buttons in their DM. The callback is handled in `WebhookController`:
- **Approve (`approve_sessionId|name`):** Calls `ProfileBuilder.finalize(sessionId)` → sets `onboardingStatus = approved`, assigns `member` role.
- **Deny (`deny_sessionId|name`):** Calls `ProfileBuilder.reject(sessionId)` → sets `onboardingStatus = denied`.

Only founding members and admins/superadmins can trigger approvals.

### Bootstrap (First User)

If no founding members exist when `save_interview` is called, the first user is **automatically approved as Superadmin and Founding Member** without needing founder approval. This is the expected flow on first deployment.

Alternatively, the `/claim-admin` command can be used before the onboarding interview to bootstrap directly.

---

## Secrets Vault

### Storing a Secret

```
/secret LABEL VALUE
/secret LABEL VALUE expires:30
```

- **DM only** — Elena rejects the command in group chats
- The original message is deleted immediately after receipt
- A DM confirmation is sent (never in-group)

### How Secrets Are Encrypted

- **Algorithm:** AES-256-GCM
- **Key derivation:** HKDF (sha256) from `SECRET_ENCRYPTION_KEY` + the user's Telegram ID as derivation context
- **IV:** Fresh 12-byte random IV on every write (never reused)
- **Auth tag:** 16-byte GCM auth tag appended to ciphertext
- **Result stored:** `encryptedValue` (base64) + `iv` (base64) in the `Secret` table

### Rotation

When you store a secret with a label that already exists, the old row is **deleted** and a new row is **inserted** in a single transaction. The `Secret` model has no `updatedAt` field by design — secrets are never mutated in place to prevent IV reuse.

### Expiry

- Set with `expires:DAYS` when storing
- `SecretExpiryService.purgeExpiredSecrets()` runs periodically (via BullMQ repeatable job)
- Expired secrets trigger a DM to the owner before deletion

### Listing Secrets

`/secrets` returns only labels — values are never exposed to any interface.

### Access Control

- Secrets are isolated per user. Each user's secrets are encrypted with a key derived from their Telegram ID.
- Agents **do not** have access to secret values via tools. The `decryptedSecretsSet` on `AgentContext` exists for the sanitizer layer to mask values if they appear in responses — it is populated only if explicitly loaded.

---

## Role Management

There are **no `/promote` or `/demote` commands.** Role changes are done in plain English — Elena's TaskAgent handles them via the `update_user_profile` tool, which is HITL-gated (requires `/confirm_`).

### Role Hierarchy

| Role | Can be set by | Capacity |
|---|---|---|
| `guest` | Auto-assigned on group join | Unlimited |
| `member` | Founders/admins via approve_user or update_user_profile | Unlimited |
| `admin` | Superadmin only | Max **2** |
| `superadmin` | Only claimable if none exists (via `/claim-admin` or bootstrap) | Max **1** |

### Rules Enforced in Code

- **Superadmin cannot be downgraded** — `update_user_profile` rejects any attempt to change the superadmin's role.
- **Admin capacity:** Promoting a 3rd admin returns `Limit reached: The squad already has the maximum of 2 Admins.`
- **Superadmin capacity:** There can only ever be 1 superadmin. Promoting a second returns `Limit reached`.
- **Admins cannot modify superadmins** — only the superadmin can update another admin; admins cannot touch the superadmin row.
- **Cannot promote unapproved users** — trying to set someone to `admin` or `member` who hasn't completed onboarding returns an error pointing you to `approve_user` first.
- **Downgrading to guest restores unapproved state** — sets `onboardingStatus = denied`, which causes `OnboardingDetector` to treat them as `unknown`. Their onboarding sessions are also cleared.

### Example Natural Language Requests

```
Promote @mike to admin
elena, give @sarah admin access
demote @john back to member
elena remove @spammer — set them to guest
elena update @alice's display name to Alice Smith
```

Each of these will trigger an HITL proposal. You'll see a message like:

```
⚠️ Action Proposed: update_user_profile

• targetUserId: 123456789
• role: admin

To execute: /confirm_chatId:abc123
To cancel:  /cancel_chatId:abc123
```

Type `/confirm_chatId:abc123` to execute or `/cancel_chatId:abc123` to abort.

---

## Failure Scenarios

### Redis (Upstash) Down

- **Hot memory:** All reads return `[]`. All writes are silently dropped (non-fatal error logged).
- **HITL:** HITL state cannot be written or read. `/confirm_` and `/cancel_` commands fail silently.
- **Dedup gate:** The `update_id` idempotency check fails, allowing Telegram retries through (mild risk of duplicate processing).
- **User sees:** Elena operates without conversation context — she'll respond without remembering the thread.

### Qdrant Down

- **Warm memory search:** Returns `[]`. Non-fatal — error logged.
- **Warm memory store:** Silently dropped. Non-fatal — error logged.
- **User sees:** No visible degradation. Elena has less semantic context available.

### Gemini 429 (Rate Limit)

- `GeminiService` extracts the `retry-after` header and waits before retrying with the next model tier.
- **Fallback chain:** `gemini-3.1-pro-preview` → `gemini-3-flash-preview` → `gemini-3.1-flash-lite-preview`
- **User sees:** Longer response time. Model badge in ARCHITECTURE logs shows fallback was triggered.

### Gemini All Models Fail

- `GeminiService` throws `ModelError` after exhausting all tiers.
- `BaseAgent.run()` catches non-transient errors (PROHIBITED_CONTENT, 400). For these, it returns a graceful fallback message.
- Transient exhaustion rethrows → BullMQ retries the job (up to 3 attempts with exponential backoff).
- **User sees:** Either a graceful apology message, or no response (if all retries fail, job moves to dead-letter queue).

### Postgres (Supabase) Down

- Webhook pipeline fails during user lookup → exception caught → update_id lock released → job returns `{ ok: true }`.
- `MessageProcessor` fails during context assembly → notifies user: *"I'm having a moment — my memory is hazy right now."*
- **User sees:** Warning message that context is degraded.

### Media File Too Large (>20MB)

- `message.parser.ts` detects file_size > 20MB during parsing.
- Sets `oversizeNote: '[System: file too large to process (>20MB)]'` on the parsed text.
- **User sees:** Elena receives the note as part of the message text and should explain the limitation naturally.

### HITL Timeout (>5 Minutes)

- Redis key `hitl:{jobId}` expires after 300 seconds.
- If user types `/confirm_` after expiry: `⚠️ This confirmation request has expired (5m limit).`
- The pending action is gone — the user must re-request the action.

### Message Too Long for Telegram (>4096 chars)

- `ReplySenderService.sendReply()` runs the text through `chunkMessage()` which splits at safe boundaries.
- Each chunk is sent as a separate Telegram message in sequence.
- If MarkdownV2 parsing fails on a chunk: falls back to plain text automatically.
- **User sees:** Multiple messages in sequence instead of one.

---

## Scheduled Jobs

Elena uses BullMQ for scheduling future tasks and background jobs.

**Currently Running:**
- `ReminderDeliveryHandler` (`elena-scheduled` queue): Delivers remainder messages to the target chat or DM at the specific time `scheduledFor` defined when the reminder was set.

**Registered but Handler Not Implemented Yet (Phase 5):**
- `nightly-summarize`
- `purge-secrets`
- `compress-memory`
- `cleanup-gemini-files`
