import { Controller, Get, Query, Sse } from '@nestjs/common';
import { Observable, filter, from, map } from 'rxjs';
import { AiService } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }

  @Sse('chat/stream')
  stream(@Query('query') query: string): Observable<{ data: string }> {
    return from(this.aiService.streamChain(query)).pipe(
      filter((chunk) => chunk.length > 0),
      map((chunk) => ({ data: chunk })),
    );
  }
}