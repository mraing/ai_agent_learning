/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-19 15:32:05
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 16:01:36
 * @FilePath: /ai agent learning/cron-job-tool/src/ai/ai.controller.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Controller, Get, Query, Sse } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { Observable, from, map } from 'rxjs';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }

  @Sse('chat/stream')
  chatStream(@Query('query') query: string): Observable<MessageEvent> {
    const stream = this.aiService.runChainStream(query);
    return from(stream).pipe(
      // 使用类型断言解决MessageEvent类型不匹配问题，NestJS会自动处理SSE消息格式
      map((chunk) => ({
        data: chunk,
      } as MessageEvent)),
    );
  }
}