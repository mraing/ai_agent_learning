/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-19 22:41:55
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 23:06:27
 * @FilePath: /ai agent learning/cron-job-tool/src/users/users.module.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
