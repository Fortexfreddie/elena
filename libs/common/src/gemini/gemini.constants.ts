export const GEMINI_MODELS = {
    /** Lite model for routing/filtering — cheapest, fastest, free tier */
    FILTER: 'gemini-3.1-flash-lite-preview',
    /** Flash model for general tasks — fast, capable, free tier */
    FLASH: 'gemini-3-flash-preview',
    /** Pro model for complex tasks — most capable, free tier */
    PRO: 'gemini-3.1-pro-preview',
    /** Fallback model when PRO/FLASH fails (429/500/503) */
    FALLBACK: 'gemini-3.1-flash-lite-preview',
    /** Embedding model for Qdrant vectors */
    EMBEDDING: 'gemini-embedding-001',
} as const;

/**
 * gemini-embedding-001 default output is 3072 dimensions.
 * We use 768 for Qdrant storage efficiency (MRL — quality loss is negligible).
 * MUST match Qdrant collection size (elena-memory: size=768, distance=Cosine).
 */
export const EMBEDDING_DIMENSIONS = 768;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

/** Max tool call iterations in the agent loop */
export const MAX_TOOL_CALLS = 5;

/** Tool result character limit before truncation */
export const TOOL_RESULT_MAX_CHARS = 15_000;

/** Telegram message character limit */
export const TELEGRAM_MAX_CHARS = 4096;

/** Max media file size Telegram allows (bytes) */
export const MAX_MEDIA_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/** Threshold for inline vs File API upload (bytes) */
export const INLINE_MEDIA_THRESHOLD = 10 * 1024 * 1024; // 10MB

/** Hot memory: max messages to store/retrieve per chat */
export const HOT_MEMORY_MAX_MESSAGES = 15;

/** Hot memory TTL in seconds */
export const HOT_MEMORY_TTL_SECONDS = 7200; // 2 hours

/** HITL pending action TTL in seconds */
export const HITL_TTL_SECONDS = 300; // 5 minutes

/** Embedding chunk limit in words (maps to ~2048 token limit) */
export const EMBEDDING_CHUNK_MAX_WORDS = 1500;

/** Technical keywords for active listening and routing heuristics */
export const TECHNICAL_KEYWORDS = [
    'solana', 'rpc', 'wallet', 'token', 'mint', 'transaction', 'tx',
    'bug', 'fix', 'error', 'failed', 'issue', 'crash',
    'flutter', 'nextjs', 'react', 'prisma', 'redis', 'bullmq',
    'nest', 'api', 'webhook', 'backend', 'frontend',
    'the chatter project', 'elena', 'bot', 'agent',
    'bounty', 'task', 'code', 'repo', 'github'
];
