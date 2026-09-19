/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-19 15:32:05
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 23:20:00
 * @FilePath: /ai agent learning/cron-job-tool/src/ai/ai.service.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { z } from 'zod';
import { Runnable } from '@langchain/core/runnables';
import { UserService } from './user.service.js';

const queryUserArgsSchema = z.object({
  userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
});

type QueryUserArgs = {
  userId: string;
}

/** 工具的最小接口，避免依赖 LangChain 的具体泛型 */
type ToolLike = {
  invoke: (args: any) => Promise<unknown>;
};

const SYSTEM_PROMPT = `你是一个通用任务助手，可以根据用户的目标规划步骤，并在需要时调用工具：\`query_user\` 查询或校验用户信息、\`send_mail\` 发送邮件、\`web_search\` 进行互联网搜索、\`db_users_crud\` 读写数据库 users 表、\`cron_job\` 创建和管理定时/周期任务（\`list\`/\`add\`/\`toggle\`），从而实现提醒、定期任务、数据同步等各种自动化需求。

需要知道“现在是什么时间”时（例如计算“10 分钟后”对应的时刻），先调用 \`time_now\` 拿到当前时间，再换算。

定时任务类型选择规则（非常重要）：
- 用户说“X分钟/小时/天后”“在某个时间点”“到点提醒”（一次性）=> 用 \`cron_job\` + \`type=at\`（执行一次后自动停用），\`at\`=当前时间+X 或解析出的时间点
- 用户说“每X分钟/每小时/每天”“定期/循环/一直”（重复执行）=> 用 \`cron_job\` + \`type=every\`（每次执行），\`everyMs\`=X换算成毫秒
- 用户给出 Cron 表达式或明确说“用 cron 表达式”（重复执行）=> 用 \`cron_job\` + \`type=cron\`

在调用 \`cron_job.add\` 创建任务时，需要把用户原始自然语言拆成两部分：一部分是“什么时候执行”（用来决定 type/at/everyMs/cron），另一部分是“要做什么任务本身”。\`instruction\` 字段只能填“要做什么”的那部分文本（保持原语言和原话），不能再改写、翻译或总结。

当用户请求“在未来某个时间点执行某个动作”（例如“1分钟后给我发一个笑话到邮箱”）时，本轮对话只需要使用 \`cron_job\` 设置/更新定时任务，不要在当前轮直接完成这个动作本身：不要直接调用 \`send_mail\` 给他发邮件，也不要在当前轮就真正“执行”指令，只需把要执行的动作写进 \`instruction\` 里，交给将来的定时任务去跑。

注意：像“\`1分钟后提醒我喝水\`”，时间相关信息用于计算下一次执行时间，而 \`instruction\` 应该是“提醒我喝水”；本轮不需要立刻提醒。`;

@Injectable()
export class AiService {
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;
  /** 由 UserService 包装出来的 LangChain 工具，runChain / runChainStream 共用 */
  private readonly queryUserTool;
  /** 工具名 → 工具对象，新增工具只要在这里登记一次 */
  private readonly tools: Record<string, ToolLike>;

  constructor(
    @Inject('CHAT_MODEL') model: ChatOpenAI,
    @Inject('SEND_MAIL_TOOL') private readonly sendMailTool: any,
    @Inject('WEB_SEARCH_TOOL') private readonly webSearchTool: any,
    @Inject('DB_USERS_CRUD_TOOL') private readonly dbUsersCrudTool: any,
    @Inject('TIME_NOW_TOOL') private readonly timeNowTool: any,
    @Inject('CRON_JOB_TOOL') private readonly cronJobTool: any,
    private readonly userService: UserService,
  ) {
    // 把 UserService 的方法包装成 LangChain 工具（服务负责数据，工具负责给模型调用）
    this.queryUserTool = tool(
      async ({ userId }: QueryUserArgs) => {
        const user = this.userService.findOne(userId);

        if (!user) {
          const ids = this.userService
            .findAll()
            .map((item) => item.id)
            .join(', ');
          return `用户 ID ${userId} 不存在。可用的 ID: ${ids}`;
        }

        return `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`;
      },
      {
        name: 'query_user',
        description:
          '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
        schema: queryUserArgsSchema,
      },
    );

    // 工具登记表：模型能调用的所有工具都放这里，bindTools 与执行分派共用这一份
    this.tools = {
      query_user: this.queryUserTool,
      send_mail: this.sendMailTool,
      web_search: this.webSearchTool,
      db_users_crud: this.dbUsersCrudTool,
      time_now: this.timeNowTool,
      cron_job: this.cronJobTool,
    };

    this.modelWithTools = model.bindTools(Object.values(this.tools));
  }

  /**
   * 执行任意工具并把结果统一成字符串。
   * 关键：无论成功、报错还是工具名不存在，都必须返回内容 ——
   * 模型提出的每个 tool_call 都要有对应的 ToolMessage，否则下一轮请求会被 API 拒收（400）。
   */
  private async runTool(name: string, args: unknown): Promise<string> {
    const toolImpl = this.tools[name];

    if (!toolImpl) {
      return `未知工具 ${name}，可用工具：${Object.keys(this.tools).join(', ')}`;
    }

    try {
      const result = await toolImpl.invoke(args);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      // 工具自身失败（比如 SMTP 认证不通过）不能把整个请求打断，
      // 把错误信息回给模型，让它自己决定怎么告诉用户
      return `工具 ${name} 执行失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async runChain(query: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(query),
    ];

    while (true) {
      const aiMessage = await this.modelWithTools.invoke(messages);
      messages.push(aiMessage);

      const toolCalls = aiMessage.tool_calls ?? [];

      // 没有要调用的工具，直接把回答返回给调用方
      if (!toolCalls.length) {
        return aiMessage.content as string;
      }

      // 依次执行本轮需要调用的所有工具：
      // 必须为每个 tool_call 都推一条 ToolMessage，漏掉任何一个都会导致下一轮 400
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

  async *runChainStream(query: string): AsyncIterable<string> {
   const messages: BaseMessage[] = [
     new SystemMessage(SYSTEM_PROMPT),
     new HumanMessage(query),
   ];

   while (true) {
     // 一轮对话：先让模型思考并（可能）提出工具调用
     const stream = await this.modelWithTools.stream(messages);

     let fullAIMessage: AIMessageChunk | null = null;

     for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
       // 使用 concat 持续拼接，得到本轮完整的 AIMessageChunk
       fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;

       const hasToolCallChunk =
         !!fullAIMessage.tool_call_chunks &&
         fullAIMessage.tool_call_chunks.length > 0;

       // 只要当前轮次还没出现 tool 调用的 chunk，就可以把文本内容流式往外推
       if (!hasToolCallChunk && chunk.content) {
           yield chunk.content as string
       }
     }

     if (!fullAIMessage) {
       return;
     }

     messages.push(fullAIMessage);

     const toolCalls = fullAIMessage.tool_calls ?? [];

     // 没有工具调用：说明这一轮就是最终回答，已经在上面的 for-await 中流完了，可以结束
     if (!toolCalls.length) {
       return;
     }

     // 有工具调用：本轮我们不再额外输出内容，而是执行工具，生成 ToolMessage，进入下一轮
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
