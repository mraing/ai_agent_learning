import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { JobModule } from '../job/job.module.js';
import { LlmService } from './llm.service.js';
import { SendMailToolService } from './send-mail-tool.service.js';
import { WebSearchToolService } from './web-search-tool.service.js';
import { DbUsersCrudToolService } from './db-users-crud-tool.service.js';
import { TimeNowToolService } from './time-now-tool.service.js';
import { CronJobToolService } from './cron-job-tool.service.js';

/**
 * 所有 tool 集中在这里维护：
 * 每个 tool 一个 service（内部构造出 LangChain tool），
 * 再用 token 暴露出去，业务模块只依赖 token，不关心 tool 怎么造出来的。
 */
@Module({
  imports: [UsersModule, forwardRef(() => JobModule)],
  providers: [
    LlmService,
    SendMailToolService,
    WebSearchToolService,
    DbUsersCrudToolService,
    TimeNowToolService,
    CronJobToolService,
    {
      provide: 'CHAT_MODEL',
      useFactory: (llmService: LlmService) => llmService.getModel(),
      inject: [LlmService],
    },
    {
      provide: 'SEND_MAIL_TOOL',
      useFactory: (svc: SendMailToolService) => svc.tool,
      inject: [SendMailToolService],
    },
    {
      provide: 'WEB_SEARCH_TOOL',
      useFactory: (svc: WebSearchToolService) => svc.tool,
      inject: [WebSearchToolService],
    },
    {
      provide: 'DB_USERS_CRUD_TOOL',
      useFactory: (svc: DbUsersCrudToolService) => svc.tool,
      inject: [DbUsersCrudToolService],
    },
    {
      provide: 'TIME_NOW_TOOL',
      useFactory: (svc: TimeNowToolService) => svc.tool,
      inject: [TimeNowToolService],
    },
    {
      provide: 'CRON_JOB_TOOL',
      useFactory: (svc: CronJobToolService) => svc.tool,
      inject: [CronJobToolService],
    },
  ],
  exports: [
    'CHAT_MODEL',
    'SEND_MAIL_TOOL',
    'WEB_SEARCH_TOOL',
    'DB_USERS_CRUD_TOOL',
    'TIME_NOW_TOOL',
    'CRON_JOB_TOOL',
  ],
})
export class ToolModule {}
