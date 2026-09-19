/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-19 22:41:55
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 22:44:59
 * @FilePath: /ai agent learning/cron-job-tool/src/users/entities/user.entity.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    length: 50
  })
  name: string;

  @Column({
    length: 50
  })
  email: string;

  @CreateDateColumn({
    type: 'timestamp'
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamp'
  })
  updatedAt: Date;
}