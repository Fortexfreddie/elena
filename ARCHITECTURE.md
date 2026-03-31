# Elena — Backend Architecture

## System Overview

```
Telegram
   │
   ▼ POST /webhook
┌──────────────────────────────────────────────┐
│  elena-web (Cloud Run)                        │
│  ┌──────────────────────────────────────────┐ │
│  │  TelegramSecretGuard (header validation) │ │
│  │  update_id idempotency gate (Redis SETNX)│ │
│  │  WebhookController                       │ │
│  │    ├─ /claim-admin → ClaimAdminCommand   │ │
│  │    ├─ /confirm_, /cancel_ → HITL queue   │ │
│  │    ├─ /secret, /secrets, /clear          │ │
│  │    ├─ callback_query → approval flow     │ │
│  │    └─ all else → MessageParser           │ │
│  │         ├─ HeuristicGate                 │ │
│  │         └─ QueueService.addMessageJob()  │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
         │ BullMQ (elena-messages queue)
         ▼ Upstash Redis
┌──────────────────────────────────────────────┐
│  elena-worker (Cloud Run)                     │
│  ┌──────────────────────────────────────────┐ │
│  │  MessageProcessor                        │ │
│  │    ├─ OnboardingDetector.check()         │ │
│  │    │    ├─ 'known' → AI pipeline         │ │
│  │    │    └─ other → InterviewerService    │ │
│  │    ├─ Media download (Telegram API)      │ │
│  │    ├─ AssemblerService (Hot+Warm+Cold)   │ │
│  │    ├─ FilterAgent (gemini-flash-lite)    │ │
│  │    │    ├─ ignore → drop                 │ │
│  │    │    ├─ reply → send directly         │ │
│  │    │    └─ route → ManagerAgent.execute()│ │
│  │    └─ ManagerAgent                       │ │
│  │         ├─ Direct specialists (bypass)   │ │
│  │         └─ Manager reasoning loop       │ │
│  │              └─ BaseAgent.run() loop    │ │
│  │                   ├─ Gemini API call    │ │
│  │                   ├─ Tool execution     │ │
│  │                   └─ HITL suspension    │ │
│  │                                         │ │
│  │  HitlProcessor (elena-hitl queue)       │ │
│  │  ReminderDeliveryHandler (elena-scheduled)│ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘

External Services:
  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐
  │ Supabase     │  │ Upstash Redis │  │ Qdrant Cloud   │
  │ (PostgreSQL) │  │ BullMQ + Hot  │  │ (Warm Memory)  │
  │ via Prisma   │  │ memory + dedup│  │ 768-dim Cosine │
  └──────────────┘  └───────────────┘  └────────────────┘
  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐
  │ Google Gemini│  │ Serper.dev    │  │ Jina Reader    │
  │ PRO/Flash/   │  │ (web_search)  │  │ (doc_scraper)  │
  │ Lite+Embed   │  │               │  │                │
  └──────────────┘  └───────────────┘  └────────────────┘
```

---

## Directory Structure

```
elena/
├── src/
│   ├── main.ts                              # Web server bootstrap (NestJS HTTP + Grammy bot init)
│   ├── worker.ts                            # BullMQ worker bootstrap (separate process, no HTTP)
│   ├── app.module.ts                        # Root module — conditionally loads web vs worker modules
│   ├── health.controller.ts                 # GET /health — Cloud Run liveness probe
│   │
│   ├── telegram/                            # Webhook ingestion + outbound messaging
│   │   ├── webhook.controller.ts            #   POST /webhook — commands, HITL, queue push pipeline
│   │   ├── message.parser.ts                #   Raw TelegramUpdate -> ParsedMessage (media, replies)
│   │   ├── heuristic-gate.ts                #   Stage 1 zero-cost pre-filter (DM / mention / keyword)
│   │   ├── reply.sender.ts                  #   Grammy outbound — auto-chunk, auto-retry, status msgs
│   │   ├── dm.dispatcher.ts                 #   Private DM sender + AuditLog entry
│   │   ├── reaction.sender.ts               #   Thinking emoji reaction on incoming messages
│   │   ├── media.service.ts                 #   File download: base64 (<=10MB) or Gemini File API (>10MB)
│   │   ├── security-alert.service.ts        #   DMs superadmins on stranger / guest activity
│   │   └── guards/
│   │       └── telegram-secret.guard.ts     #   X-Telegram-Bot-Api-Secret-Token validation
│   │
│   ├── queue/                               # BullMQ job definitions + processors
│   │   ├── queue.module.ts                  #   Registers 3 queues: elena-messages, elena-hitl, elena-scheduled
│   │   ├── queue.service.ts                 #   addMessageJob / addHitlResumeJob / addReminderJob
│   │   ├── message.processor.ts             #   Main AI pipeline (concurrency: 10, lock: 30s)
│   │   ├── hitl.processor.ts                #   HITL confirm/cancel with atomic Redis consume
│   │   └── job.types.ts                     #   MessageJob, HITLResumeJob, QUEUE_NAMES, RepeatableJobName
│   │
│   ├── agents/                              # AI agent layer
│   │   ├── base.agent.ts                    #   Abstract base: Gemini tool loop, stuck detection, fallback
│   │   ├── filter.agent.ts                  #   Stage 2 router — ignore / reply / route (Flash Lite)
│   │   ├── manager.agent.ts                 #   Orchestrator — direct tool access or delegates (Flash)
│   │   ├── coder.agent.ts                   #   Code writing, debugging, explanation (Pro)
│   │   ├── reviewer.agent.ts                #   Code review, security audit, best practices (Pro)
│   │   ├── researcher.agent.ts              #   Web research, docs, pricing/version queries (Flash)
│   │   ├── brainstorm.agent.ts              #   Architecture exploration, devil's advocate (Pro)
│   │   ├── task.agent.ts                    #   Bounties, reminders, DMs, role changes (Flash)
│   │   ├── onboarding.agent.ts              #   Interview conductor — NOT routed via Filter/Manager
│   │   ├── personas.injector.ts             #   System prompt builder + sanitizeForPrompt()
│   │   └── status.builder.ts                #   Formats live Telegram status message during agent run
│   │
│   ├── memory/                              # Tiered memory services
│   │   ├── hot.memory.service.ts            #   Redis sliding window (15 msgs, 2h TTL, distributed lock)
│   │   ├── warm.memory.service.ts           #   Qdrant semantic search + store (768-dim, Cosine)
│   │   ├── cold.memory.service.ts           #   Postgres reads: user profiles + active bounties
│   │   ├── assembler.service.ts             #   Merges all 3 tiers -> AssembledContext before agent call
│   │   └── index.ts                         #   Barrel re-export
│   │
│   ├── tools/                               # Tool registry + implementations
│   │   ├── base.tool.ts                     #   AgentTool interface (name, argsSchema, requiresConfirmation)
│   │   ├── registry.service.ts              #   Central FunctionDeclaration store + getTool() lookup
│   │   ├── executor.service.ts              #   Execution wrapper: Zod validation, HITL gate, truncation
│   │   ├── web-search.tool.ts               #   Serper.dev API (SERPER_API_KEY) — 8 organic results
│   │   ├── doc-scraper.tool.ts              #   Jina Reader r.jina.ai — URL->Markdown (SSRF protected)
│   │   ├── github-fetch.tool.ts             #   Octokit: get_repo / get_issues / get_file (GITHUB_TOKEN)
│   │   ├── memory-search.tool.ts            #   Calls WarmMemoryService.search() with access control
│   │   ├── log-monitor.tool.ts              #   error.log tail reader — redacts tokens/URLs
│   │   ├── run-code.tool.ts                 #   Code execution (vm sandbox, TS transpilation)
│   │   ├── generate-image.tool.ts           #   Gemini Image generation with Pollinations fallback
│   │   ├── prompt-engineer.tool.ts          #   Transforms vague ideas into structured prompts
│   │   ├── bounty-update.tool.ts            #   Bounty CRUD via Prisma — create/update/list (HITL)
│   │   ├── send-reminder.tool.ts            #   Creates Reminder row + BullMQ delayed job
│   │   ├── send-dm.tool.ts                  #   DmDispatcherService wrapper — admin+ only (HITL)
│   │   ├── approve-user.tool.ts             #   Calls ProfileBuilder.finalize() — founders/admins (HITL)
│   │   ├── update-user-profile.tool.ts      #   Role / displayName / persona changes (HITL)
│   │   ├── view-user-profile.tool.ts        #   View role, persona, and preferences for a given user
│   │   ├── save-interview.tool.ts           #   Persists OnboardingAgent interview data to session
│   │   └── delegate-task.tool.ts            #   Signals Manager to hand off; returns terminateLoop: true
│   │
│   ├── onboarding/                          # New user recognition + interview pipeline
│   │   ├── detector.service.ts              #   check() -> 'known' | 'pending' | 'unknown'
│   │   ├── interviewer.service.ts           #   Session orchestration + distributed lock (120s)
│   │   ├── approver.service.ts              #   notifyFounders() — DM with InlineKeyboard buttons
│   │   ├── claim-admin.command.ts           #   /claim-admin: atomic bootstrap or member->admin promotion
│   │   └── onboarding.module.ts
│   │
│   ├── personas/                            # Profile lifecycle management
│   │   ├── profile-builder.service.ts       #   finalize() sets approved + member; reject() sets denied
│   │   └── personas.module.ts
│   │
│   ├── scheduled/                           # Background task handlers
│   │   ├── reminder-delivery.handler.ts     #   Processes elena-scheduled queue — DM or group delivery
│   │   ├── compress-memory.handler.ts       #   Nightly job to summarize long hot memory threads
│   │   ├── morning-message.handler.ts       #   Sends daily motivational message to active groups
│   │   ├── cleanup-gemini-files.handler.ts  #   Deletes stale Gemini API files older than 24h
│   │   ├── purge-secrets.handler.ts         #   Removes expired secrets and notifies owners
│   │   ├── scheduled.processor.ts           #   BullMQ WorkerHost mapping job names to handlers
│   │   └── scheduled.module.ts
│   │
│   ├── secrets/                             # Per-user encrypted secret vault
│   │   ├── vault.service.ts                 #   AES-256-GCM + HKDF: storeSecret / getSecret / listSecrets
│   │   ├── secret-expiry.service.ts         #   purgeExpiredSecrets() — DMs owner before deletion
│   │   └── secrets.module.ts
│   │
│   ├── audit/                               # DM audit logging module
│   │   └── audit.module.ts
│   └── safety/                              # HITL + message sanitization module
│       └── safety.module.ts
│
├── libs/                                    # Shared internal NestJS libraries
│   ├── common/                              #   Cross-cutting: Gemini, types, utilities, Redis
│   │   └── src/
│   │       ├── gemini/
│   │       │   ├── gemini.service.ts        #     SDK wrapper: generateContent (3-tier fallback), embed, File API
│   │       │   ├── gemini.constants.ts      #     GEMINI_MODELS, MAX_TOOL_CALLS=5, HITL_TTL, HOT_MEMORY_TTL
│   │       │   └── gemini.module.ts
│   │       ├── types/
│   │       │   ├── agent.types.ts           #     AgentContext, AssembledContext, FilterDecision, ToolResult
│   │       │   ├── telegram.types.ts        #     TelegramUpdate, ParsedMessage
│   │       │   └── errors.ts               #     ElenaError, ModelError, ToolError, AuthError...
│   │       ├── upstash-redis.service.ts     #     @upstash/redis REST client (hot memory + update_id dedup)
│   │       ├── upstash-redis.module.ts
│   │       └── utils/
│   │           ├── chunk.ts                 #     Smart message splitter for 4096-char Telegram limit
│   │           ├── semantic-chunk.ts        #     Sentence-boundary splitter for warm memory storage
│   │           ├── escape.ts                #     escapeMarkdownV2, escapeHtml
│   │           ├── retry.ts                 #     Generic retry-with-backoff helper
│   │           └── sleep.ts                 #     Async sleep for model fallback waits
│   ├── config/                              #   Env validation (runs at startup, fails fast on missing vars)
│   │   └── src/
│   │       └── env.validation.ts            #     Joi schema for all required env vars
│   └── database/                            #   Global PrismaModule — selects URL from PROCESS_TYPE
│       └── src/
│           ├── database.module.ts
│           └── database.service.ts          #     SUPABASE_WEB_URL (web) vs SUPABASE_WORKER_URL (worker)
│
├── prisma/
│   └── schema.prisma                        # DB schema: User, Bounty, Secret, OnboardingSession,
│                                            #            Reminder, HitlPending, AuditLog, Feedback
├── Dockerfile                               # node:20-alpine — single image, PROCESS_TYPE controls behavior
├── cloudbuild.yaml                          # GCP Cloud Build CI/CD -> elena-web + elena-worker
├── docker-compose.yml                       # Local dev: app + ngrok tunnel
└── .env.example                             # Template for all environment variables
```

---



---

## Request Lifecycle

A complete trace from Telegram webhook to Elena's reply:

**Step 0: Webhook receipt**
- Telegram sends `POST /webhook` with an `Update` object
- `TelegramSecretGuard` validates the `X-Telegram-Bot-Api-Secret-Token` header — returns 401 if wrong
- Atomic `SETNX update:${updateId}` with 1-hour TTL in Redis. Duplicate → silent `{ ok: true }`

**Step 0.5: Command interception**
Before parsing the message, the controller checks for special commands (case insensitive):
- `callback_query` with `approve_*` or `deny_*` → Approval flow (only founders/admins can trigger)
- `/confirm_*` or `/cancel_*` → HITL resume: validates sender is admin OR original requester, adds to HITL queue
- `/claim-admin` → ClaimAdminCommand (atomic transaction)
- `/clear` → Admin-only: deletes `hot:{chatId}` from Redis
- `/secret ...` → VaultService: enforces DM-only, stores secret, deletes message, DMs confirmation
- `/secrets` → VaultService: lists labels for caller

**Step 1: Parse**
- `parseMessage(update, botId)` → `ParsedMessage | null`
- Returns null for bot messages, channel posts, messages with no `from`
- Extracts text, media (with MIME type and 20MB size check), reply context, DM flag

**Step 2: Group-First Security Guard**
- For group messages: upserts user as `guest` if not in DB (auto-registration)
- For DMs: if user not in DB → silent drop + sends stranger alert to superadmins via `SecurityAlertService`

**Step 3: Stage 1 Heuristic Gate** (zero cost, no AI)
`shouldProcess(parsed)` returns false (drop) unless:
- Message is a DM, OR
- Message is a reply to a bot message, OR
- Text contains: `elena`, `@elena`, `hey elena`, `yo elena`, OR
- Text contains a technical keyword (Solana, redis, bullmq, api, bounty, etc.), OR
- Text starts with `/`

**Step 4: Rate limiting**
`// TODO-PHASE2: RateLimiterService check here` — not yet implemented.

**Step 5: Thinking reaction**
`ReactionSenderService.sendThinkingReaction()` — sends a thinking emoji reaction to the message.

**Step 6: Queue**
`QueueService.addMessageJob(parsed, updateId)` → adds job to BullMQ `elena-messages` queue, attempts: 3, exponential backoff starting at 2s.

**Step 7: Return**
Webhook returns `{ ok: true }` immediately. Telegram never waits for AI processing.

---

**Worker picks up the job:**

**Step W1: Typing action**
`replySender.sendTypingAction()` — shows "typing..." indicator.

**Step W2: Onboarding check**
`OnboardingDetector.check(userId)` → `'known' | 'pending' | 'unknown'`
- Not `'known'`: routes to `InterviewerService.handleMessage()` → sends onboarding reply → exits pipeline.
- If user is `unknown` or `pending` and messaging via DM: sends `GuestActivityAlert` to superadmins.

**Step W3: Media download**
If `hasMedia`:
- ≤10MB: download via Telegram API, encode base64 → `inlineData`
- >10MB: download to temp file, upload to Gemini File API → `fileData` with `fileUri`
Then: extract media context text (Gemini Flash describes the image/audio/video in 2–3 sentences).

**Step W4: Memory assembly**
1. Add user message to hot memory (with distributed lock)
2. `AssemblerService.assemble(chatId, telegramId)` → `AssembledContext`

**Step W5: Filter**
`FilterAgent.route()` → `FilterDecision`
- `ignore` (in DM): overridden to route to manager
- `ignore` (in group): exit pipeline silently
- `reply`: store in hot+warm memory, send reply, exit
- `route`: continue to manager

**Step W6: Status message**
Send initial status message to chat (e.g., `👨💻 Coder Agent\n━━━━━━━━━━━━━━━━━━━\n⏳ Starting up...`)

**Step W7: Agent execution**
`ManagerAgent.execute(routeTo, agentContext)`:
- If routeTo is `coder/reviewer/researcher/brainstorm/task`: skip manager reasoning, invoke specialist directly
- If routeTo is `manager`: run manager's own `BaseAgent.run()` loop

**Step W8: Reply**
- Delete status message
- Send final text reply (chunked if >4096 chars)
- Store in hot + warm memory

**Step W9: Cleanup**
If a Gemini File API file was uploaded: delete it in `finally` block.

---

## Agent Pipeline

```
FilterAgent (gemini-flash-lite)
    │
    ├── action: ignore → drop
    ├── action: reply → send directly (no specialist)
    └── action: route → ManagerAgent.execute(routeTo)
                              │
                              ├── routeTo = coder|reviewer|
                              │   researcher|brainstorm|task
                              │   → bypass manager, invoke specialist.run()
                              │
                              └── routeTo = manager
                                  → ManagerAgent runs BaseAgent.run()
                                      │
                                      └── if delegate_task called:
                                          → invokeSpecialist(agent)
```

**Key design decision:** Filter routes directly to specialists for 95%+ of requests, bypassing Manager reasoning entirely to save tokens and latency. Manager reasoning only runs when Filter explicitly routes to `manager` (DMs, coordination tasks, commands).

**Specialist invocation:** Always a direct async function call — `coderAgent.run(context)`, `reviewerAgent.run(context)`, etc. Not a separate queue job. This is intentional: specialists share the same BullMQ job context, so HITL suspension state, media content, and secrets set persist correctly.

**delegate_task pattern:** If the Manager does run its reasoning loop and decides to delegate, it calls the `delegate_task` tool. This tool returns `terminateLoop: true`, which tells `BaseAgent.run()` to exit its while loop immediately. `ManagerAgent.execute()` then checks the function calls for `delegate_task` and invokes the appropriate specialist.

---

## Tool Execution Loop

`BaseAgent.run(context: AgentContext)`:

```typescript
while (iterations < MAX_TOOL_CALLS) {  // MAX_TOOL_CALLS = 5
  iterations++;
  
  // Call Gemini with history + tools
  const response = await geminiService.generateContent(model, history, { systemInstruction, tools });
  history.push(response.rawContent); // preserves thought signatures
  
  if (!response.functionCalls) {
    // Pure text response — return it
    return { text: response.text, ... };
  }

  // Loop-stuck detection: hash the current call-set
  // If we've seen this exact call-set before → return stuck message
  
  for (const call of response.functionCalls) {
    if (toolsCalled.length >= MAX_TOOL_CALLS) {
      // Return limit-reached error for this tool call
      continue;
    }
    
    // Fire status update callback (updates Telegram status message)
    await context.onStatusUpdate?.({ currentTool: call.name, ... });
    
    // Execute via ExecutorService
    const result = await executorService.executeCall(call, context);
    
    if (result.suspended) {
      // HITL: break the loop, return suspended state
      isSuspended = true;
    }
    if (result.terminateLoop) {
      // delegate_task: exit loop immediately
      return { text: response.text, ... };
    }
    
    toolResponseParts.push({ functionResponse: { name, response: { result } } });
  }
  
  // Push tool results as user message (Gemini multi-turn pattern)
  history.push({ role: 'user', parts: toolResponseParts });
  
  if (isSuspended) return suspendedResponse;
}

// Max iterations reached: prompt Gemini for a best-effort final answer
history.push({ role: 'user', parts: [{ text: 'Give your best answer now...' }] });
return finalSummary;
```

**HITL suspension:** When `ExecutorService.executeCall()` encounters a tool with `requiresConfirmation: true`:
1. Generates a random nonce: `jobId = ${chatId}:${nonce}`
2. Serializes the pending call + full context (minus media) to Redis key `hitl:${jobId}` with 300s TTL
3. Sends a proposal message to Telegram with `/confirm_{jobId}` and `/cancel_{jobId}` instructions
4. Returns `{ suspended: true }` → agent exits loop and returns `suspended` state to processor

**Resume:** `/confirm_JOBID` is received by WebhookController → validates sender role/identity → `QueueService.addHitlResumeJob()` → `HitlProcessor.process()`:
1. Atomic claim: `SET hitl:claim:{jobId} 1 NX EX 600` — prevents double-execution
2. Fetch pending data from Redis
3. Atomic consume: `DEL pendingActionKey` before execution
4. Execute tool directly
5. Send result back to original chat

---

## Memory Architecture

### Hot Memory

- **Store:** Upstash Redis, REST client (`@upstash/redis`)
- **Key:** `hot:{chatId}` stores the entire conversation as a JSON array
- **TTL:** 2 hours from last write (reset on every write)
- **Capacity:** Last 15 messages (truncated on write)
- **Sort:** Sorted by `telegramDate` (Unix timestamp), then `updateId` for same-second ordering — prevents out-of-order display from concurrent jobs
- **Race condition protection:**
  - Lock key: `hot:lock:{chatId}` with `SETNX` + 5s TTL
  - If lock not acquired: wait 100ms, retry once. If retry fails: drop the write (prefer data loss over corruption)
  - Lock released in `finally` block

### Warm Memory

- **Store:** Qdrant Cloud
- **Collection:** `elena-memory` (configurable via `QDRANT_COLLECTION`)
- **Dimensions:** 768 (MRL-reduced from model default of 3072 for storage efficiency)
- **Distance metric:** Cosine
- **Embedding model:** `gemini-embedding-001`
  - Document storage uses `taskType: 'RETRIEVAL_DOCUMENT'`
  - Query search uses `taskType: 'RETRIEVAL_QUERY'`
- **Payload indexes:** `accessLevel` (keyword), `userId` (keyword) — created on `OnModuleInit`
- **Access control filter (OR):**
  - `accessLevel == 'public'` → visible to all
  - `userId == callerTelegramId` → visible to that user only
- **When stored:** After every agent reply (both filter-direct and specialist replies), stored as `"user message | elena reply"` pair
- **Auto-search:** `AssemblerService` extracts the last 3 hot messages as a search query (max 300 chars, backticks and role prefixes stripped) and runs warm search before every agent call

### Cold Memory

- **Store:** Supabase PostgreSQL via Prisma ORM
- **What is read:** `User` row (telegramId, displayName, role, personaJson, preferencesJson), `Bounty` rows (open/in_progress, last 10)
- **Fetched fresh on every request** — not cached (Supabase Transaction Pooler handles connection pooling)
- **Read-only from agent perspective** — agents modify Postgres only via tools (bounty_update, approve_user, etc.) which go through validated Prisma calls

### AssemblerService

```typescript
const [hotMessages, userProfile] = await Promise.all([
  hotMemory.getHistory(chatId),
  coldMemory.getUserProfile(telegramId),
]);
hotMessages.sort(byDateThenUpdateId);
activeBounties = userProfile ? await coldMemory.getActiveBounties(userProfile.id) : [];
warmResults = await warmMemory.search(queryFromLast3Hot, telegramId);
return { hotMessages, userProfile, activeBounties, warmResults };
```

---

## HITL Flow

```
User request
  → Agent calls bounty_update or send_dm (requiresConfirmation = true)
  ↓
ExecutorService detects requiresConfirmation
  → Generate nonce: jobId = "${chatId}:${random6bytes}"
  → Serialize { toolName, args, requesterId, context } to Redis
    Key: hitl:${jobId}   TTL: 300s
  → Send Telegram proposal:
    "⚠️ Action Proposed: bounty_update
     Details:
     • action: create
     • title: New bounty name
     
     To execute: /confirm_chatId:abc123
     To cancel:  /cancel_chatId:abc123"
  → Return { suspended: true }
  ↓
BaseAgent exits loop, processor returns without sending reply

User types /confirm_chatId:abc123 (or /cancel_)
  ↓
WebhookController HITL handler:
  1. Fetch hitl:{jobId} from Redis → extract requesterId
  2. Check sender: must be admin/superadmin OR sender == requesterId
     If unauthorized → silent drop
  3. action = confirm → QueueService.addHitlResumeJob(jobId, confirmedBy)
  4. action = cancel  → QueueService.addHitlCancelJob(jobId, cancelledBy)

HitlProcessor picks up job:
  1. Atomic claim: SET hitl:claim:{jobId} NX EX 600
     Already claimed → silent return (prevents double-execution)
  2. action = cancel → delete pending key, send "❌ Action cancelled."
  3. action = confirm:
     → Fetch pending data from Redis
     → Rehydrate decryptedSecretsSet (Set serialized as array for JSON round-trip)
     → Atomic consume: DEL hitl:{jobId} before execution
       consumed == 0 → already executed → "⚠️ This action was already executed."
     → Execute tool.execute(args, context)
     → Send result to original chat
```

**TTL handling:** The claim key TTL (600s) is longer than the pending key TTL (300s). This ensures a late `/confirm_` after expiry hits the missing pending key path, not the already-claimed path.

---

## Secrets Architecture

### Encryption Scheme

```
SECRET_ENCRYPTION_KEY (32 bytes, from env)
          │
          ▼ HKDF(sha256, masterKey, derivationId, 'elena-vault-v1', 32)
User-specific key (32 bytes)
          │
          ├─ randomBytes(12) → IV (96-bit, fresh per write)
          │
          ▼ createCipheriv('aes-256-gcm', userKey, iv)
Encrypted = cipher.update(value) + cipher.final() + cipher.getAuthTag()
                                                      ↑ 16-byte auth tag appended

Stored in DB:
  encryptedValue: base64(encrypted + authTag)
  iv:             base64(iv)
```

**Derivation ID:** The user's Telegram ID (string). Each user gets a unique encryption key derived from their Telegram ID. Even if two users store secrets with the same label, the ciphertext is different.

**Why no `updatedAt` on `Secret`:** Secrets must never be modified in place. An in-place update would require reusing the same row structure. By design, rotation = DELETE old row + INSERT new row with fresh IV, all in a single `$transaction`. No `updatedAt` field enforces this — there is no update path in the code or schema.

**`decryptedSecretsSet` flow:** When the webhook controller loads secrets for an agent request (not currently wired for general use — this is infrastructure for a sanitizer layer), decrypted plaintext values are added to `decryptedSecretsSet` on the `AgentContext`. The set is passed through the entire pipeline so a response sanitizer can mask values if the AI outputs them accidentally. The `Set` is serialized as an array for Redis round-trips (JSON.stringify(Set) produces `{}`).

---

## Onboarding State Machine

### High-Level Sequence Flow
```
New user sends message
  → OnboardingDetector: unknown/pending
  → InterviewerService.handleMessage()
  → OnboardingAgent runs (gemini-3-flash-preview)
  → Agent has ONE tool: save_interview
  → Asks questions one at a time
  → When enough info gathered → calls save_interview
  → InterviewerService detects save_interview in response.functionCalls
  → ProfileBuilder.buildProfile() creates persona_json
  → ApproverService.notifyFounders() DMs all founders
  → Founders receive approve/deny buttons
  → /approve_{sessionId} → approve_user tool / ProfileBuilder.finalize()
  → On confirm → user.onboardingStatus = approved
```

### Detailed Execution
```
User appears in group chat
  → WebhookController upserts with role: 'guest'
  → onboardingStatus: 'pending' (default)

User DMs Elena without being in group
  → Drop (Group-First Guard)
  → SecurityAlertService.sendStrangerAlert() to superadmins

MessageProcessor receives message from non-'known' user
  → OnboardingDetector.check() returns 'pending' or 'unknown'
  → Route to InterviewerService

InterviewerService:
  → Acquire distributed lock: lock:onboarding:{userId} (120s TTL)
  → Find or create OnboardingSession (status: in_progress)
  → Upsert User row:
      - Approved already? Skip status re-init
      - Otherwise: create/update with onboardingStatus: 'pending'
  → Run OnboardingAgent (save_interview tool)
  → If save_interview called:
      → Update session: status = pending_approval, builtProfileJson = data
      → ApproverService.notifyFounders() → DM to all isFoundingMember = true users
        with InlineKeyboard [✅ Approve | ❌ Deny]
      
      If founders.length == 0 (bootstrap):
        → ProfileBuilder.finalize(sessionId)
        → Promote user to superadmin + isFoundingMember = true
        → Reply: "Welcome home, boss! 🚀 ..."
      
      If founders exist:
        → Set user.onboardingStatus = 'pending'
        → Reply: "Got it! I've sent your request to the squad founders."

Founder clicks ✅ Approve in their DM:
  → WebhookController handles callback_query with data: "approve_{sessionId}|{displayName}"
  → Verify clicker is isFoundingMember OR role admin/superadmin
  → ProfileBuilder.finalize(sessionId)
  → Reply to founder: "✅ Approved: *DisplayName* is now part of the squad."

Founder clicks ❌ Deny:
  → ProfileBuilder.reject(sessionId)
  → Reply to founder: "❌ Denied: *DisplayName* request rejected."

State transitions:
  unknown → [group join] → guest/pending
  pending → [save_interview + founders notify] → pending_approval
  pending_approval → [founder approves] → approved
  pending_approval → [founder denies] → denied
  denied → treated as unknown (dropped in DMs)

Bootstrap shortcut:
  anyone → [/claim-admin with no superadmin in DB] → superadmin + approved
  approved_member → [/claim-admin with < 2 admins] → admin
```

---

## Database Schema

### User

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Internal Prisma ID |
| `telegramId` | String (unique) | Used as primary lookup for all webhook operations |
| `username` | String? | Telegram @handle (nullable) |
| `displayName` | String | First name or interview-provided name |
| `role` | Enum | `guest` / `member` / `admin` / `superadmin` |
| `personaJson` | Json | Identity facts (e.g. summary, coreSkills, pronouns) |
| `preferencesJson` | Json | Interaction rules (e.g. technicalTone, allowProactiveDms, timezone, verbosityLevel) |
| `onboardingStatus` | Enum | `pending` / `approved` / `denied` |
| `isFoundingMember` | Boolean | Receives approval notifications |
| `isActive` | Boolean | Soft delete flag |
| `createdAt` | DateTime | Auto |
| `updatedAt` | DateTime | Auto (`@updatedAt`) |

### Secret

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `label` | String | Plain text label (e.g. `GITHUB_PAT`) |
| `encryptedValue` | String | AES-256-GCM ciphertext + auth tag, base64 |
| `iv` | String | 12-byte IV, base64 |
| `expiresAt` | DateTime? | Optional expiry |
| `createdAt` | DateTime | Auto |
| — | — | **No `updatedAt`** — secrets are never updated in place |
| `ownerUserId` | String | FK to User.id |

**Unique constraint:** `(ownerUserId, label)` — one secret per label per user.

### Bounty

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `title` | String | |
| `description` | String? | |
| `status` | Enum | `open` / `in_progress` / `submitted` / `completed` / `dropped` |
| `platform` | String? | External platform name |
| `deadline` | DateTime? | |
| `submissionLink` | String? | |
| `rpcUrl` | String? | |
| `notes` | String? | |
| `createdById` | String | FK to User.id |
| `assignedToId` | String? | FK to User.id |

### Reminder

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `chatId` | String | Target chat or DM ID |
| `targetType` | String | `group` or `dm` |
| `targetUserId` | String? | Numeric Telegram ID for DM delivery |
| `confirmationMessage` | String | Shown to user when reminder is set |
| `reminderMessage` | String | Delivered at scheduled time |
| `scheduledFor` | DateTime | When to fire |
| `sent` | Boolean | Idempotency flag |
| `sentAt` | DateTime? | When it was delivered |
| `userId` | String | FK to User.id (who created it) |

### OnboardingSession

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Used as `sessionId` in approval buttons |
| `telegramId` | String | Raw Telegram ID of applicant |
| `conversationJson` | Json | Array of `{ role, text }` interview messages |
| `builtProfileJson` | Json | Interview result: displayName, role, technicalTone, summary |
| `status` | Enum | `in_progress` / `pending_approval` / `approved` / `denied` |
| `approvedById` | String? | FK to User.id of approving founder |

### AuditLog

Written by `DmDispatcherService` for every DM sent. Fields: `actionType`, `toolCalled`, `sanitizedSummary`.

### HitlPending

Schema exists for HITL record-keeping but the primary HITL state is stored in Redis (not this table) for performance. The `HitlPending` table is present in schema but the current HITL processor reads/writes Redis directly.

### Feedback

User feedback records with optional Langfuse trace ID. Not yet wired to the agent pipeline.

---

## Deployment Architecture

Two Cloud Run services share a single Docker image. `PROCESS_TYPE` env var controls what starts:
- `web` → starts `dist/src/main.js` (NestJS HTTP server)
- `worker` → starts `dist/src/worker.js` (BullMQ worker, no HTTP)

### elena-web

- **Purpose:** Receives Telegram webhook POSTs, handles commands, pushes jobs to BullMQ
- `--max-instances=40` — Telegram can deliver many concurrent webhooks
- `--allow-unauthenticated` — Public HTTPS endpoint required for Telegram
- `--port=3000`
- Uses **Supabase Transaction Pooler** (`SUPABASE_WEB_URL`, port 6543) — each Cloud Run instance is short-lived and stateless, so PgBouncer's session pooling does not apply; transaction-mode is correct

### elena-worker

- **Purpose:** Runs the BullMQ consumer (MessageProcessor, HitlProcessor, ReminderDeliveryHandler)
- `--no-cpu-throttling` — BullMQ workers must maintain an active Redis connection. CPU throttling on Cloud Run pauses execution between requests, which breaks the persistent connection. Workers need always-on CPU.
- `--min-instances=1` — Ensures at least one worker is always running to drain the queue
- `--memory=2Gi` — Gemini File API uploads and media processing plus concurrent jobs require more memory than the default 512Mi
- `--no-allow-unauthenticated` — Worker has no public endpoints; internal only
- `--timeout=600` — Agent execution can take 30–90s; default 60s would time out complex tasks
- Uses **Supabase Direct Connection** (`SUPABASE_WORKER_URL`, port 5432) — long-running process, direct pooling is appropriate; connection_limit=5 matches BullMQ concurrency

### Upstash Redis Split

- **BullMQ (ioredis):** Uses `UPSTASH_REDIS_URL` (`rediss://`) via ioredis — required for BullMQ's blocking `BRPOP` calls
- **Hot memory + dedup gate:** Uses `UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_TOKEN` via `@upstash/redis` REST client — serverless-friendly for the web instances that don't need persistent connections

### BullMQ Queues

| Queue | Name | Purpose | Retry |
|---|---|---|---|
| Messages | `elena-messages` | All Telegram messages | 3 attempts, exponential from 2s |
| HITL | `elena-hitl` | Confirm/cancel pending actions | 1 attempt (idempotency via Redis) |
| Scheduled | `elena-scheduled` | Reminder delivery | 5 attempts, exponential from 5s |

---

## Security Architecture

Security layers in processing order:

**1. Webhook secret validation**
`TelegramSecretGuard` checks `X-Telegram-Bot-Api-Secret-Token` header. Returns 401 to Telegram if wrong — Telegram stops retrying.

**2. Update ID idempotency**
`SETNX update:{updateId} 1 EX 3600` — atomic, first writer wins. Duplicate updates are silently dropped. Lock is released on pipeline error so Telegram's retry can get through.

**3. Role checks on commands**
- `/clear`: requires `admin` or `superadmin` role. Others: silent drop.
- `/secret`: requires `member`, `admin`, or `superadmin`. Guests: silent drop.
- HITL commands: requires `admin`/`superadmin` OR the original requester. Others: silent drop.
- Approval buttons: requires `isFoundingMember = true` OR `admin`/`superadmin`. Others: silent drop.

**4. Group-First guard**
Unknown users in DMs are silently dropped. They must appear in the group first. This prevents cold-start spam.

**5. Stage 1 Heuristic gate**
Zero-cost pre-filter before any AI is called. Drops messages that don't mention Elena, don't contain technical keywords, aren't DMs, and aren't replies to the bot.

**6. Rate limiting**
`// TODO-PHASE2` — not yet implemented.

**7. HITL role validation**
During HITL resume, `processedBy` is re-validated against the stored `requesterId` and current database role. The role is re-checked at resume time, not just at submission — a user whose role changed after submitting the request will be blocked.

**8. Prompt injection protection (`PersonasInjector`)**
`sanitizeForPrompt()` strips:
- Newlines and carriage returns (prevents fake sections)
- Role-like prefixes (`SYSTEM:`, `ADMIN:`, `USER:`, `ROLE:`, `NOTE:`, `SECRET:`, `INSTRUCTION:`)
- Truncates to 50 characters max

Applied to user-controlled inputs (displayName, role) before injecting into system prompts.

**9. Log sanitization (`LogMonitorTool`)**
Before returning log content to agents, sensitive patterns are redacted:
- Telegram bot tokens: `bot[REDACTED]`
- API keys: OpenAI (`sk-...`), Google (`AIza...`), xAI (`xai-...`)
- Bearer tokens: `Bearer [REDACTED]`
- Database URLs: `[REDACTED_DB_URL]`
- Redis URLs: `[REDACTED_REDIS_URL]`
- Password fields: `password=[REDACTED]`

**10. Secret isolation**
Secret values are never passed directly to agents. `decryptedSecretsSet` on `AgentContext` exists for a future sanitizer layer that would mask values if the AI accidentally outputs them. The set is stripped before Redis serialization during HITL suspension.

**11. Doc scraper SSRF protection**
`DocScraperTool` validates URLs before fetching: only `http:`/`https:` protocols, and blocks `localhost`, `127.0.0.1`, `169.254.169.254` (AWS metadata endpoint), `0.0.0.0`, `::1`.

**12. DM-only secret commands**
`/secret` is rejected in group chats with an explicit error. Original message is deleted immediately on receipt.

**13. Security alerts**
`SecurityAlertService` sends DMs to superadmins for:
- Stranger activity (unknown user messaging in DM)
- Guest activity (guest/pending user messaging in DM)

---

## Error Handling & Resilience

### Error Class Hierarchy

```
ElenaError (base — code, statusCode)
  ├── ValidationError  (VALIDATION_ERROR, 400)
  ├── DatabaseError    (DATABASE_ERROR, 500)
  ├── MemoryError      (MEMORY_ERROR, 500)
  ├── ModelError       (MODEL_ERROR, 502)
  ├── ToolError        (TOOL_ERROR, 500)
  ├── SafetyError      (SAFETY_ERROR, 403)
  └── AuthError        (AUTH_ERROR, 401)
```

### Degradation Rules

| Failure | Behavior |
|---|---|
| Redis read error | Return `[]` for hot memory. Non-fatal, logged. |
| Redis write error | Log and continue. Non-fatal. |
| Qdrant error | Return `[]` for warm results. Non-fatal, logged. |
| Gemini 429/500/503 | Retry with next model tier (Flash → Lite). Wait for `retry-after`. |
| Gemini PROHIBITED_CONTENT | Catch in both `FilterAgent` and `BaseAgent`, return graceful apology. |
| Gemini 400 Bad Request | Catch in `BaseAgent`, return "couldn't process" message. |
| Gemini all tiers fail | BullMQ retries job (attempts: 3, exponential backoff from 2s). |
| Postgres error in webhook | Release update_id lock, return `{ ok: true }` to Telegram. |
| Postgres error in worker | Processor fails → job retried by BullMQ. |
| Memory assembly failure | Notify user ("my memory is hazy"), continue with empty context. |
| Status message send failure | Warn, continue (non-fatal). |
| Status message delete failure | Silently swallow (non-fatal). |
| Tool execution throws | `ExecutorService` catches → returns `{ success: false, error: msg }` to agent. |
| Tool result too large | Truncate to `TOOL_RESULT_MAX_CHARS` (15,000 chars) + truncation note. |
| Media download failure | Log error, continue without media. |
| Gemini File API cleanup failure | Warn, don't throw (cleanup is best-effort). |

### BullMQ Retry Config

| Queue | Attempts | Backoff |
|---|---|---|
| `elena-messages` | 3 | Exponential, starting at 2s |
| `elena-hitl` | 1 | None (idempotency handled via Redis claim key) |
| `elena-scheduled` | 5 | Exponential, starting at 5s |

Failed jobs are preserved (removeOnFail: `{ count: 50 }`) for inspection.

### SIGTERM Graceful Shutdown

Cloud Run sends SIGTERM before terminating. BullMQ's `WorkerHost` handles this by draining in-flight jobs before exit (NestJS lifecycle hooks). The `--timeout=600` on the worker service gives up to 10 minutes for in-flight jobs to complete.

---

## Known Limitations & Future Work

### Not yet implemented

- **Rate limiting** — `// TODO-PHASE2` comment in `WebhookController`. No per-user rate limits currently enforced.
- **Langfuse tracing** — Keys present in `.env.example` but not wired into the agent pipeline.
- **Feedback model** — `Feedback` table exists in Prisma schema but no write path is implemented.
- **`HitlPending` table** — Schema exists but HITL state is stored in Redis, not this table. The table is not written to in any current code path.
- **Secret-to-agent pipeline** — `decryptedSecretsSet` infrastructure exists but secrets are not automatically loaded for agent requests. Agents cannot currently read secret values.
- **Warm memory writing from onboarding** — Onboarding interviews are not stored in warm memory.

### Known design constraints

- **Qdrant collection must be created manually** before first boot if `onModuleInit` cannot create it (the service will attempt auto-create but this may fail on some Qdrant Cloud tiers).
- **Hot memory is per-chat, not per-user** — In a group chat, all members share the same hot memory context. Elena sees everyone's messages in that chat.
- **Warm memory is private by default** — All entries written by the current pipeline use `accessLevel: 'private'`. There is no current path to write `public` entries (e.g., shared project documentation).
- **Admin capacity is hardcoded at 2** — In `ClaimAdminCommand`, `adminCount >= 2` blocks further admin claims. This is not configurable via environment.
- **File uploads via Gemini File API are synchronous** — For files >10MB, the worker downloads to disk, uploads to Google's servers, and waits. This can take 20–40s for large video files.
- **No message edit handling** — If a user edits a Telegram message, the edit update is ignored (no `message.edited_message` handler).
