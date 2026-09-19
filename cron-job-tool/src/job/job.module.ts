import { Module, forwardRef } from '@nestjs/common';
import { JobService } from './job.service.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  // JobService 需要 JobAgentService（在 AiModule 里），
  // 而 AiModule -> ToolModule -> JobModule 又依赖本模块，所以用 forwardRef 处理循环引用
  imports: [forwardRef(() => AiModule)],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}
