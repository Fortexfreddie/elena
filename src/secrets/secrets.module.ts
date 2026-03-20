import { Module, forwardRef } from '@nestjs/common';
import { VaultService } from './vault.service';
import { SecretExpiryService } from './secret-expiry.service';
import { PrismaModule } from '@app/database';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [VaultService, SecretExpiryService],
  exports: [VaultService, SecretExpiryService],
})
export class SecretsModule {}
// Phase 5 placeholder — providers added in Phase 5
