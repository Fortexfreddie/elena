import type { ParsedMessage } from './telegram.types';
import type { FunctionCall, Part } from '@google/genai';
import { z } from 'zod';

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
  mediaContent?: Part;
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
 * Onboarding interview data saved by the agent.
 */
export const SaveInterviewArgsSchema = z.object({
  displayName: z.string().min(1),
  role: z.string().min(1),
  technicalTone: z.string().min(1),
  summary: z.string().min(1),
});

export type SaveInterviewArgs = z.infer<typeof SaveInterviewArgsSchema>;

/**
 * Arguments for updating a user's profile.
 */
export const UpdateUserProfileArgsSchema = z.object({
  targetUserId: z.string().describe('The Telegram ID of the user to update.'),
  displayName: z.string().optional(),
  role: z.enum(['superadmin', 'admin', 'member', 'guest']).optional(),
  summary: z.string().optional(),
  technicalTone: z.string().optional(),
});

export type UpdateUserProfileArgs = z.infer<typeof UpdateUserProfileArgsSchema>;

/**
 * Result from a tool execution.
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  suspended?: boolean; // NEW: Indicates execution is paused for HITL
  terminateLoop?: boolean; // NEW: Signals agent to exit reasoning loop immediately
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
