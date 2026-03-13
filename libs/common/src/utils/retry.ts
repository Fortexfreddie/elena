import { ElenaError } from '../types/errors';

interface RetryOptions {
    /** Max number of attempts (including first try) */
    maxAttempts: number;
    /** Initial delay in ms before first retry */
    initialDelayMs: number;
    /** Multiplier for each subsequent retry */
    backoffMultiplier: number;
    /** Optional: only retry on these error types */
    retryableCheck?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
};

/**
 * Exponential backoff wrapper for external API calls.
 * Retries on failure with increasing delays.
 *
 * @throws The last error if all attempts fail
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {},
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: unknown;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error: unknown) {
            lastError = error;

            // If there's a retryable check and it says no, throw immediately
            if (opts.retryableCheck && !opts.retryableCheck(error)) {
                throw error;
            }

            // Don't delay after the last attempt
            if (attempt < opts.maxAttempts) {
                const delay =
                    opts.initialDelayMs *
                    Math.pow(opts.backoffMultiplier, attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    // All attempts exhausted
    if (lastError instanceof ElenaError) {
        throw lastError;
    }

    const message =
        lastError instanceof Error
            ? lastError.message
            : 'Unknown error after retries';
    throw new Error(`withRetry exhausted ${opts.maxAttempts} attempts: ${message}`);
}
