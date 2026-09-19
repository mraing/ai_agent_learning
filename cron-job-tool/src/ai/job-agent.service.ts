import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { Runnable } from '@langchain/core/runnables';

/** 工具的最小接口，避免依赖 LangChain 的具体泛型 */
type ToolLike = {
  invoke: (args: any) => Promise<unknown>;
};

/**
 * 定时任务专用的 agent loop：
 * 到点后拿数据库里存的 instruction 文本，跑一轮完整的工具调用循环，把任务真正做掉。
 * 这里同步 invoke 就够了，不需要流式。
 */
@Injectable()
export class JobAgentService {
  private readonly logger = new Logger(JobAgentService.name);
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;
  private readonly tools: Record<string, ToolLike>;

  constructor(
    @Inject('CHAT_MODEL') model: ChatOpenAI,
    @Inject('SEND_MAIL_TOOL') sendMailTool: any,
    @Inject('WEB_SEARCH_TOOL') webSearchTool: any,
    @Inject('DB_USERS_CRUD_TOOL') dbUsersCrudTool: any,
    @Inject('TIME_NOW_TOOL') timeNowTool: any,
  ) {
    // 刻意不注入 cron_job：禁止在定时任务里再创建定时任务（避免无限套娃）
    this.tools = {
      send_mail: sendMailTool,
      web_search: webSearchTool,
      db_users_crud: dbUsersCrudTool,
      time_now: timeNowTool,
    };

    this.modelWithTools = model.bindTools(Object.values(this.tools));
  }

  /** 与 AiService.runTool 同样的约定：无论成功失败都要返回内容，保证每个 tool_call 都有 ToolMessage */
  private async runTool(name: string, args: unknown): Promise<string> {
    const toolImpl = this.tools[name];

    if (!toolImpl) {
      return `未知工具 ${name}，可用工具：${Object.keys(this.tools).join(', ')}`;
    }

    try {
      const result = await toolImpl.invoke(args);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      return `工具 ${name} 执行失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async runJob(instruction: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是一个用于执行后台任务的智能代理。你会根据给定的任务指令，必要时调用工具（如 db_users_crud、send_mail、web_search、time_now 等）来查询或改写数据，然后给出清晰的步骤和结果说明。',
      ),
      new HumanMessage(instruction),
    ];

    while (true) {
      const aiMessage = await this.modelWithTools.invoke(messages);
      messages.push(aiMessage);

      const toolCalls = aiMessage.tool_calls ?? [];

      if (!toolCalls.length) {
        return String(aiMessage.content ?? '');
      }

      for (const toolCall of toolCalls) {
        const result = await this.runTool(toolCall.name, toolCall.args);

        messages.push(
          new ToolMessage({
            tool_call_id: toolCall.id || '',
            name: toolCall.name,
            content: result,
          }),
        );
      }
    }
  }
}
