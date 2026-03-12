import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
} from '@nestjs/common';
import { AuthError } from '@app/common/types/errors';

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
            throw new AuthError('TELEGRAM_WEBHOOK_SECRET is not set');
        }
        this.secret = secret;
    }

    canActivate(context: ExecutionContext): boolean {
        const request = context
            .switchToHttp()
            .getRequest<{ headers: Record<string, string | undefined> }>();

        const headerSecret =
            request.headers['x-telegram-bot-api-secret-token'];

        if (!headerSecret || headerSecret !== this.secret) {
            this.logger.warn('Rejected webhook request: invalid secret token');
            throw new AuthError('Invalid Telegram webhook secret');
        }

        return true;
    }
}
