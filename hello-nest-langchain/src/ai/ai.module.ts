/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-19 09:04:44
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 11:20:36
 * @FilePath: /ai agent learning/hello-nest-langchain/src/ai/ai.module.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Module } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { AiController } from './ai.controller.js';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';



@Module({
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: 'CHAT_MODEL',
      useFactory: ( configService: ConfigService ) => {
        return new ChatOpenAI({
          apiKey: configService.get('DEEPSEEK_API'),
          modelName: configService.get('MODEL_NAME'),
          configuration: {
            baseURL: configService.get('BASE_URL'),
          },
        });
      },
      inject: [ConfigService],
    }
  ],
})
export class AiModule {}
