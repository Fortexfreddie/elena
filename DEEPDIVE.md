# Elena — Deep Dive: Technical Architecture & Core Systems

This document provides an extremely detailed technical breakdown of Elena's architecture, control flows, and core components. It is intended for senior engineers and architects onboarding onto the project.

---

## 🏗️ System Architecture

Elena is built as a **Modular Monolith** using NestJS. While it currently runs as a single repo, it is designed for future monorepo expansion (Phase 6+).

### Core Philosophy
1.  **Asynchronous by Design**: Webhooks are acknowledged immediately; all AI reasoning happens in background workers.
2.  **Stateless Web Layer**: The web service holds no state, allowing for easy horizontal scaling.
3.  **Tiered Memory**: Context is gathered from multiple sources (Redis, Qdrant, Postgres) to maximize reasoning accuracy and minimize hallucinations.
4.  **Specialist Delegation**: A central "Manager" orchestrates specialized sub-agents, preventing a single model from becoming a "jack of all trades, master of none."

---

## 🧩 Core Components

### 1. Agents System
Agents are located in `src/agents/` and inherit from a common `BaseAgent`.

-   **Model**: Primarily uses **Gemini 1.5/3 Pro/Flash** via the `@google/genai` SDK.
-   **System Instruction**: The persona, rules, and assembled context are injected into the `systemInstruction` config of the Gemini call, rather than the message history, to preserve attention.
-   **Autonomous Loop**: The `BaseAgent` implements a `while` loop that allows for up to **5 tool calls** in a single turn. It automatically handles tool results and pushes them back into the context for the next iteration.

#### Key Agents:
-   **ManagerAgent**: The entry point. Uses the `delegate_task` tool to call specialists.
-   **FilterAgent**: A low-cost router (Flash Lite) that decides if a message requires a reply or should be ignored.
-   **Coder/Reviewer Agents**: High-reasoning models (Pro) with GitHub and code execution tools.
-   **OnboardingAgent**: Specialized agent used during the interview flow to extract user data.

### 2. Specialist Strategy
Elena uses a **Specialist Squad** approach. Each specialist has a strict whitelist of tools they are permitted to use. This minimizes the risk of accidental or unintended tool execution.

-   **Manager**: `delegate_task`, `web_search`.
-   **Researcher**: `web_search`, `doc_scraper`, `memory_search`.
-   **Coder**: `github_fetch`, `run_code`, `log_monitor`.

### 3. Tool Architecture
Tools implement the `AgentTool` interface in `src/tools/base.tool.ts`.

-   **RegistryService**: Acts as the central hub for discovering and providing tool declarations (JSON Schema) to agents.
-   **ExecutorService**: The execution engine that validates Zod schemas, checks for HITL requirements, runs the tool logic, and handles data truncation (>15k chars).

---

## 🔄 Execution Flow

When a user sends a message, it flows through the following pipeline:

1.  **WebhookController**: Receives the POST from Telegram.
2.  **Idempotency Gate**: Checks Redis for the `update_id` to prevent double-processing.
3.  **Heuristic Gate**: Quickly determines if Elena is tagged or mentioned.
4.  **QueueService**: Pushes a `MessageJob` to BullMQ. **WEB REQUEST ENDS HERE (200 OK).**
5.  **MessageProcessor (Worker)**:
    -   **Context Enrichment**: Pulls reply-to context if applicable.
    -   **Memory Assembler**: Fetches last 15 messages from Redis (Hot), relevant vectors from Qdrant (Warm), and user profile/bounties from Postgres (Cold).
    -   **FilterAgent**: Determines if the message is an "Ignore", "Direct Reply", or "Route to Manager".
    -   **ManagerAgent**: Orchestrates the multi-turn tool loop.
6.  **ReplySender**: Chunks and sends the final response back via the Grammy API.
7.  **Audit Service**: Logs the entire trace (latency, model, tools used) for observability.

---

## 💾 Memory Hierarchy

| Tier | Source | Purpose | Data Life |
| :--- | :--- | :--- | :--- |
| **Hot** | Upstash Redis | Recent chat context (sliding window of 15 messages). | 2 Hours |
| **Warm** | Qdrant Cloud | Semantic search against all past interactions (RAG). | Persistent |
| **Cold** | Postgres | Hard data: User profiles, personas, bounties, and secrets. | Persistent |

**Warm Memory Query Logic**: Elena does not search with the raw incoming text. Instead, she concatenates the last 3 sorted hot messages to provide meaningful semantic "nouns" to the embedding model.

---

## 🔒 Security & Safety

### Human-in-the-Loop (HITL)
For sensitive tool calls (e.g., `bounty_update` or `run_code`), the `ExecutorService`:
1.  Suspends the agent loop.
2.  Serializes the pending action to Postgres (`HitlPending` table) and Redis.
3.  Sends a Telegram message with `Confirm/Cancel` buttons.
4.  Upon user confirmation, a `HitlProcessor` resumes the specific tool call with the original context.

### Secret Management
User-specific secrets (e.g., GitHub tokens) are never stored in plaintext. They are encrypted using **AES-256-GCM** with a fresh 12-byte IV for every record. Decryption only happens in memory immediately before a tool call.

### Sanitization
A two-layer sanitizer runs on every outgoing message:
1.  **Exact Match**: Redacts any secrets known to be in the current context.
2.  **Regex**: Redacts standard patterns like `sk-...` (OpenAI), `AIza...` (Google), and JWTs.

---

## 🛠️ Extending the System

### Adding a New Agent
1.  Extend `BaseAgent`.
2.  Set the `model` and `systemInstruction`.
3.  Whitelisted tools are injected via constructor.
4.  Register in `AgentsModule`.

### Adding a New Strategy
1.  Most strategies are implemented as specialized `Agent` prompts and tool whitelists.
2.  Modify the `ManagerAgent` or `FilterAgent` prompts to recognize the new routing target.

### Adding a New Tool
1.  Implement `AgentTool` (see `src/tools/base.tool.ts`).
2.  Define the `argsSchema` using Zod.
3.  Write the `execute` logic.
4.  Register in `RegistryService`.

---

## 📈 Future Improvements & Limitations

### Current Limitations
-   **Sequential Tooling**: Tools are executed one-by-one in the loop. Parallel tool merging is not yet implemented.
-   **No Cross-Cycle Memory**: Agents don't "remember" their reasoning from the previous cycle unless it was explicitly saved as a "Warm" memory.
-   **Synchronous RAG**: Embedding generation and vector search are part of the worker loop and can add latency.

### Planned Improvements
-   **Vision Grounding Enhancement**: Improved "pixel-truth" logic for complex diagrams.
-   **Multi-User Tools**: Collaborative tool usage where multiple users must confirm an action.
-   **Monorepo Split**: Moving specialists into their own micro-workers for better resource isolation.
