/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-19 22:41:55
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 22:54:26
 * @FilePath: /ai agent learning/cron-job-tool/src/users/dto/create-user.dto.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsNotEmpty()
  @IsEmail()
  @MaxLength(50)
  email: string;
}