import { Injectable } from '@nestjs/common';
import { SanitizerService } from './sanitizer.service';

@Injectable()
export class MaskerService {
  constructor(private readonly sanitizer: SanitizerService) {}

  /**
   * Final masking pass — runs sanitizer with empty secrets set.
   * Belt and braces: catches anything the first pass missed.
   * Always run this before sending to Langfuse.
   */
  mask(text: string): string {
    return this.sanitizer.sanitize(text, new Set());
  }
}
