import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { validateEnv } from '@app/config';

/**
 * Elena web server bootstrap.
 *
 * - Validates env vars on startup (fails fast on missing config)
 * - Configures Pino structured logging
 * - Grammy bot is initialized inside ReplySenderService (outbound API client only)
 * - bot.handleUpdate() is NEVER called — no bot.on() listeners exist
 * - MUST call enableShutdownHooks for Cloud Run SIGTERM handling
 */
async function bootstrap(): Promise<void> {
  // Validate environment before NestJS boots — fail fast
  validateEnv(process.env as Record<string, string | undefined>);

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // Required for Cloud Run SIGTERM handling.
  // Without this, in-flight requests and DB transactions are killed
  // mid-execution with no cleanup during deploys.
  app.enableShutdownHooks();

  const port = process.env['PORT'] ?? '3000';
  await app.listen(port);
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start Elena:', err);
  process.exit(1);
});
