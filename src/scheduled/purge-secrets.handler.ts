import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SecretExpiryService } from '../secrets/secret-expiry.service';

@Injectable()
export class PurgeSecretsHandler {
  private readonly logger = new Logger(PurgeSecretsHandler.name);

  constructor(
    private readonly secretExpiry: SecretExpiryService,
  ) {}

  async handle(job: Job): Promise<void> {
    this.logger.log('[SCHEDULED] Running purge-secrets job');
    await this.secretExpiry.purgeExpiredSecrets();
    this.logger.log('[SCHEDULED] purge-secrets complete');
  }
}
