/**
 * Parse Upstash Redis URL components for ioredis connection.
 * Upstash URLs format: rediss://default:PASSWORD@HOST:PORT
 *
 * Shared between app.module.ts (web) and worker.ts to avoid duplication.
 */

export function extractRedisHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'localhost';
  }
}

export function extractRedisPort(url: string): number {
  try {
    const port = new URL(url).port;
    return port ? parseInt(port, 10) : 6379;
  } catch {
    return 6379;
  }
}

export function extractRedisPassword(url: string): string {
  try {
    return new URL(url).password;
  } catch {
    return '';
  }
}
