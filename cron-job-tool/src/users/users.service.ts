/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-19 22:41:55
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 22:55:00
 * @FilePath: /ai agent learning/cron-job-tool/src/users/users.service.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { EntityManager } from 'typeorm';
import { User } from './entities/user.entity.js';

@Injectable()
export class UsersService {

  @Inject(EntityManager)
  entityManager: EntityManager;

  create(createUserDto: CreateUserDto) {
    return this.entityManager.save(User, createUserDto);
  }

  findAll() {
    return this.entityManager.find(User);
  }

  async findOne(id: number) {
    const user = await this.entityManager.findOne(User, { where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    await this.findOne(id);
    await this.entityManager.update(User, id, updateUserDto);
    return this.findOne(id);
  }

  async remove(id: number) {
    const user = await this.findOne(id);
    await this.entityManager.delete(User, id);
    return user;
  }
}