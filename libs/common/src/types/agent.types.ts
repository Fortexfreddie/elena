import type { ParsedMessage } from './telegram.types.js';
import type { FunctionCall } from '@google/genai';

/**
 * Context passed to agents after memory assembly + persona injection.
 */
export interface AgentContext {
    parsedMessage: ParsedMessage;
    assembledContext: AssembledContext;
    /** System instruction block built by PersonasInjector — persona + rules + bounties + warm results */
    systemBlock: string;
    /** Set of decrypted secret plaintext values — fed to sanitizer Layer 1 */
    decryptedSecretsSet: Set<string>;
    /** Media content for multimodal processing (populated by worker if hasMedia) */
    mediaContent?: MediaContent;
}

export interface MediaContent {
    /** For files ≤10MB: inline base64-encoded data */
    inlineData?: {
        mimeType: string;
        data: string;
    };
    /** For files >10MB: uploaded to Gemini File API */
    fileUri?: string;
}

/**
 * Assembled context from all three memory tiers.
 */
export interface AssembledContext {
    /** Last 15 messages from hot memory, sorted by telegramDate + updateId */
    hotMessages: HotMemoryEntry[];
    /** Relevant results from Qdrant warm memory */
    warmResults: WarmResult[];
    /** User profile from Postgres */
    userProfile: UserProfile | null;
    /** Active bounties for the user */
    activeBounties: BountyInfo[];
}

export interface HotMemoryEntry {
    text: string;
    telegramDate: number;
    updateId: number;
    userId: string;
    role: 'user' | 'assistant';
}

export interface WarmResult {
    text: string;
    score: number;
    metadata: Record<string, unknown>;
}

export interface UserProfile {
    id: string;
    telegramId: string;
    username: string | null;
    displayName: string;
    role: string;
    personaJson: Record<string, unknown>;
    preferencesJson: Record<string, unknown>;
}

export interface BountyInfo {
    id: string;
    title: string;
    description: string | null;
    status: string;
    platform: string | null;
    deadline: Date | null;
}

/**
 * Response from any agent.
 */
export interface AgentResponse {
    /** Final text response to send to user */
    text: string;
    /** Agent that produced this response */
    agentName: string;
    /** Model used for generation */
    modelUsed: string;
    /** Total latency in ms */
    latencyMs: number;
    /** Self-rated confidence (0-100) — flagged if <60 */
    confidence: number;
    /** Tools that were called during this run */
    toolsCalled: string[];
    /** Raw function call objects returned by Gemini */
    functionCalls?: FunctionCall[];
}

/**
 * Result from a tool execution.
 */
export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
    truncated?: boolean;
    truncationNote?: string;
}

/**
 * Filter agent routing decision.
 */
export interface FilterDecision {
    action: 'ignore' | 'reply' | 'route';
    /** Direct reply text — only set when action is 'reply' */
    reply?: string;
    /** Target sub-agent — only set when action is 'route' */
    routeTo?: string;
    /** Reason for the decision — for audit logging */
    reason: string;
}
