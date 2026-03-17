import { z } from 'zod';
import { ValidationError } from '@app/common/types/errors';

/**
 * Zod schema for all Elena environment variables.
 * Validates on startup — server refuses to start on missing/invalid vars.
 */
const envSchema = z.object({
  // Server
  PORT: z.string().default('3000'),
  NODE_ENV: z.string().default('development'),
  PROCESS_TYPE: z.string().default('web'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .min(1, 'TELEGRAM_WEBHOOK_SECRET is required'),

  // Supabase — both URLs required
  SUPABASE_WEB_URL: z.string().min(1, 'SUPABASE_WEB_URL is required'),
  SUPABASE_WORKER_URL: z.string().min(1, 'SUPABASE_WORKER_URL is required'),

  // Upstash Redis — two clients, same instance
  UPSTASH_REDIS_URL: z.string().min(1, 'UPSTASH_REDIS_URL is required'),
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url()
    .min(1, 'UPSTASH_REDIS_REST_URL is required'),
  UPSTASH_REDIS_TOKEN: z.string().min(1, 'UPSTASH_REDIS_TOKEN is required'),

  // Qdrant Cloud (Phase 2+)
  QDRANT_URL: z.string().optional(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('elena-memory'),

  // Gemini
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

  // Langfuse (optional for Phase 1)
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().default('https://cloud.langfuse.com'),

  // Encryption
  SECRET_ENCRYPTION_KEY: z
    .string()
    .min(64, 'SECRET_ENCRYPTION_KEY must be 32 bytes hex (64 chars)')
    .max(64),

  // GitHub (optional)
  GITHUB_TOKEN: z.string().optional(),

  // Google Cloud
  GCP_PROJECT_ID: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validate environment variables against the schema.
 * Throws ValidationError with details on missing/invalid vars.
 */
export function validateEnv(
  env: Record<string, string | undefined>,
): EnvConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ValidationError(`Environment validation failed:\n${issues}`);
  }

  return result.data;
}
