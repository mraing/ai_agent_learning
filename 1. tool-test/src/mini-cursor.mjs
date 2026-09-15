// ============================================================
// mini-cursor.mjs —— 迷你版 Cursor / Claude Code：一个能自己动手干活的 Agent
//
// 功能：
//   1. 给模型绑定 4 个工具（读文件 / 写文件 / 执行命令 / 列目录，定义在 all-tools.mjs）
//   2. 用一个循环让模型自主工作：思考 -> 调用工具 -> 拿到结果 -> 再思考……
//   3. 直到模型认为任务完成，输出最终回复
//   示例任务：从零创建一个带完整功能的 React TodoList 应用（Vite + pnpm）
//
// 运行：node src/mini-cursor.mjs（会自动新建 react-todo-app 项目并安装依赖）
// ============================================================

// 自动加载 .env 配置（API Key、模型名、接口地址）
import 'dotenv/config';
// chalk：终端彩色输出库，让 Agent 的运行日志更醒目
import chalk from 'chalk';
// ChatOpenAI：对接 DeepSeek（OpenAI 兼容接口）
import { ChatOpenAI } from '@langchain/openai';
// 三种消息类型：系统消息 / 用户消息 / 工具执行结果消息
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
// 从 all-tools.mjs 引入 4 个预先定义好的工具
import { executeCommandTool, listDirectoryTool, readFileTool, writeFileTool } from './all-tools.mjs';

// 初始化聊天模型（连接 DeepSeek 服务）
const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API, // API 密钥（来自 .env）
  modelName: process.env.MODEL_NAME, // 模型名（来自 .env，如 deepseek-flash）
  temperature: 0, // 温度 0：行为更确定，减少发挥偏差
  configuration: {
    baseURL: process.env.BASE_URL, // DeepSeek 接口地址（来自 .env）
  },
});

// Agent 可用的工具清单（与 all-tools.mjs 的导出一一对应）
const tools = [
  readFileTool, // 读取文件内容
  writeFileTool, // 写入文件内容（自动建目录）
  executeCommandTool, // 执行系统命令（pnpm install / pnpm run dev 等）
  listDirectoryTool, // 列出目录内容
];

// bindTools：把工具清单"声明"给模型。
// 此后模型可以输出 tool_calls（调用请求），但工具不会自动执行，
// 真正执行发生在下面 runAgentWithTools 的循环里
const modelWithTools = model.bindTools(tools);

// ============================================================
// Agent 主循环
// 参数：
//   query         用户给 Agent 的任务描述（如"创建一个 TodoList 应用"）
//   maxIterations 最大循环轮数，防止 Agent 陷入无限循环（"思考-调用"算一轮）
// 返回值：Agent 的最终文字回复
// ============================================================
async function runAgentWithTools (query, maxIterations = 30) {
  // 每轮循环都会把 messages 完整发给模型，它是 Agent 的"记忆"
  const messages = [
    // 系统消息：给 Agent 设定角色、工作环境、工具清单和使用规则
    new SystemMessage(`你是一个项目管理助手，使用工具完成任务。

当前工作目录: ${process.cwd()}

工具：
1. read_file: 读取文件
2. write_file: 写入文件
3. execute_command: 执行命令（支持 workingDirectory 参数）
4. list_directory: 列出目录

重要规则 - execute_command：
- workingDirectory 参数会自动切换到指定目录
- 当使用 workingDirectory 时，绝对不要在 command 中使用 cd
- 错误示例: { command: "cd react-todo-app && pnpm install", workingDirectory: "react-todo-app" }
这是错误的！因为 workingDirectory 已经在 react-todo-app 目录了，再 cd react-todo-app 会找不到目录
- 正确示例: { command: "pnpm install", workingDirectory: "react-todo-app" }
这样就对了！workingDirectory 已经切换到 react-todo-app，直接执行命令即可

回复要简洁，只说做了什么`),
    // 用户消息：本次任务
    new HumanMessage(query)
  ];

  // ---- Agent 循环：最多尝试 maxIterations 轮 ----
  for (let i = 0; i < maxIterations; i++) {
    // 打印等待提示（绿色背景），让用户知道 Agent 正在思考
    console.log(chalk.bgGreen(`⏳ 正在等待 AI 思考...`));
    // 把整个对话历史发给模型，拿到本轮回复（可能是文字，也可能带 tool_calls）
    const response = await modelWithTools.invoke(messages);
    // 这轮回复也要进入"记忆"，否则模型下一轮就忘了自己说过什么
    messages.push(response);

    // 检查本轮回复里有没有工具调用请求
    // 没有 tool_calls = 模型认为任务完成（或不需要工具），直接给出最终答复
    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${response.content}\n`);
      // 任务完成，返回最终回复
      return response.content;
    }

    // ---- 执行本轮所有工具调用请求 ----
    // response.tool_calls 里的每一项：{ id, name, args }
    //   id   : 本次调用请求的唯一编号（回传结果时必须带上）
    //   name : 要调用哪个工具
    //   args : 模型按 schema 生成的调用参数
    for (const toolCall of response.tool_calls) {
      // 按工具名在清单里找到对应的工具对象
      const foundTool = tools.find(t => t.name === toolCall.name);
      if (foundTool) {
        // 真正执行工具函数（读文件 / 写文件 / 跑命令 / 列目录）
        const toolResult = await foundTool.invoke(toolCall.args);
        // 把执行结果以 ToolMessage 回传给模型：
        // tool_call_id 必须对应 toolCall.id，模型才能把结果关联到自己的请求
        messages.push(new ToolMessage({
          content: toolResult,
          tool_call_id: toolCall.id,
        }));
      }
      // 万一模型请求了一个不存在的工具，这里直接跳过（不崩溃），
      // 模型看到"没有对应结果"通常会自行修正
    }
  }

  // 达到最大轮数仍未完成：兜底返回最后一条消息的内容
  return messages[messages.length - 1].content;
}

// 示例任务：让 Agent 创建一个功能完整的 React TodoList 应用
// 注意：运行后会真的在当前目录新建 react-todo-app 项目，并执行 pnpm install / pnpm run dev
const case1 = `创建一个功能丰富的 React TodoList 应用：

1. 创建项目：echo -e "n\nn" | pnpm create vite react-todo-app --template react-ts
2. 修改 src/App.tsx，实现完整功能的 TodoList：
 - 添加、删除、编辑、标记完成
 - 分类筛选（全部/进行中/已完成）
 - 统计信息显示
 - localStorage 数据持久化
3. 添加复杂样式：
 - 渐变背景（蓝到紫）
 - 卡片阴影、圆角
 - 悬停效果
4. 添加动画：
 - 添加/删除时的过渡动画
 - 使用 CSS transitions
5. 列出目录确认

注意：使用 pnpm，功能要完整，样式要美观，要有动画效果

之后在 react-todo-app 项目中：
1. 使用 pnpm install 安装依赖
2. 使用 pnpm run dev 启动服务器
`;

// 入口：执行 Agent。try/catch 保证出错时打印醒目的错误信息而不是静默失败
try {
  await runAgentWithTools(case1);
} catch (error) {
  // 红色背景输出错误信息
  console.error(chalk.bgRed(`\n❌ 错误: ${error.message}\n`));
}