/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-18 23:15:03
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 11:08:11
 * @FilePath: /ai agent learning/hello-nest-langchain/src/app.module.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BookModule } from './book/book.module.js';
import { AiModule } from './ai/ai.module.js';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';



export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(import.meta.dirname, '..', 'public'),
    }),
    BookModule,
    AiModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
