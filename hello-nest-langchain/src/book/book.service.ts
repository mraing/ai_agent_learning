/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-18 23:18:06
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-18 23:47:59
 * @FilePath: /ai agent learning/hello-nest-langchain/src/book/book.service.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Injectable, Inject } from '@nestjs/common';
import { CreateBookDto } from './dto/create-book.dto.js';
import { UpdateBookDto } from './dto/update-book.dto.js';

@Injectable()
export class BookService {

  @Inject('BOOK_REPOSITORY')
  private readonly bookRepository: any;

  create(createBookDto: CreateBookDto) {
    return 'This action adds a new book';
  }

  findAll() {
    return this.bookRepository.findAll();
    // return `This action returns all book`;
  }

  findOne(id: number) {
    return `This action returns a #${id} book`;
  }

  update(id: number, updateBookDto: UpdateBookDto) {
    return `This action updates a #${id} book`;
  }

  remove(id: number) {
    return `This action removes a #${id} book`;
  }
}
