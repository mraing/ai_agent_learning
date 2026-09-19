/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-18 23:18:06
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-18 23:44:57
 * @FilePath: /ai agent learning/hello-nest-langchain/src/book/book.module.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Module } from '@nestjs/common';
import { BookService } from './book.service.js';
import { BookController } from './book.controller.js';

@Module({
  controllers: [BookController],
  providers: [
    BookService,
    {
      provide: 'BOOK_REPOSITORY',
      useFactory () {
        // 内存仓库
        const books: {id: number, title: string}[] = [
          {id: 1, title: 'Book 1'},
          {id: 2, title: 'Book 2'},
          {id: 3, title: 'Book 3'},
        ];
        return {
          findAll: () => [...books],
        }
      }
    }
  ],
})
export class BookModule {}
