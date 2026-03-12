import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
    @Get('/health')
    getHealth(): { status: string; timestamp: string } {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
        };
    }
}
