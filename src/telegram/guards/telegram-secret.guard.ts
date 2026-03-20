import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Guard that validates the X-Telegram-Bot-Api-Secret-Token header.
 * Returns 401 if the secret doesn't match TELEGRAM_WEBHOOK_SECRET env var.
 */
@Injectable()
export class TelegramSecretGuard implements CanActivate {
  private readonly logger = new Logger(TelegramSecretGuard.name);
  private readonly secret: string;

  constructor() {
    const secret = process.env['TELEGRAM_WEBHOOK_SECRET'];
    if (!secret) {
      throw new UnauthorizedException('TELEGRAM_WEBHOOK_SECRET is not set');
    }
    this.secret = secret;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();

    const headerSecret = request.headers['x-telegram-bot-api-secret-token'];

    if (
      !headerSecret || 
      headerSecret.length !== this.secret.length || 
      !timingSafeEqual(Buffer.from(headerSecret), Buffer.from(this.secret))
    ) {
      this.logger.warn('Rejected webhook request: invalid secret token');
      throw new UnauthorizedException('Invalid Telegram webhook secret');
    }

    return true;
  }
}
