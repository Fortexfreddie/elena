import { Module, Global } from '@nestjs/common';
import { GeminiService } from './gemini.service.js';

@Global()
@Module({
    providers: [GeminiService],
    exports: [GeminiService],
})
export class GeminiModule { }
