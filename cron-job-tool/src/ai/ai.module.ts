import { Module } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { AiController } from './ai.controller.js';
import { JobAgentService } from './job-agent.service.js';
import { UserService } from './user.service.js';
import { ToolModule } from '../tool/tool.module.js';

@Module({
  // 所有 tool（含 CHAT_MODEL）都由 ToolModule 提供，这里只关心怎么用
  imports: [ToolModule],
  controllers: [AiController],
  providers: [AiService, JobAgentService, UserService],
  // JobService 需要 JobAgentService 来执行定时任务，所以导出出去
  exports: [JobAgentService],
})
export class AiModule {}
