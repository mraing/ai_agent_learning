/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-14 22:40:11
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-14 23:00:03
 * @FilePath: /ai agent learning/1. tool-test/src/tool-file-read.mjs
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */

// ============================================================
// tool-file-read.mjs —— LangChain 工具调用（Function Calling）示例
//
// 功能：让模型使用 read_file 工具读取 src/tool-file-read.mjs 本身，并解释代码功能
// 运行：node src/tool-file-read.mjs
//
// 核心概念（务必理解）：
//   "工具调用" = 模型输出结构化的"调用意图"（tool_calls），模型本身不执行任何代码。
//   真正执行工具的是我们：解析 tool_calls -> 调用对应的 JS 函数 -> 把结果回传模型。
//   这就是下方 while 循环在做的事。
// ============================================================

// 自动加载 `.env` 文件中的环境变量（等价于 import dotenv 后调用 dotenv.config()）
import 'dotenv/config';
// ChatOpenAI：@langchain/openai 对 OpenAI 兼容接口的封装类（本示例对接 DeepSeek）
import { ChatOpenAI } from "@langchain/openai";
// tool()：LangChain 的工具工厂函数，把普通 JS 函数包装成"模型可调用的工具"
import { tool } from '@langchain/core/tools';
// 消息类型定义：HumanMessage 用户消息 / SystemMessage 系统消息 / ToolMessage 工具结果消息 / AIMessage 模型回复消息
import { HumanMessage, SystemMessage, ToolMessage, AIMessage } from '@langchain/core/messages';
// Node.js 文件系统模块（Promise 版，可直接 await）
import fs from 'node:fs/promises';
// zod：运行时数据校验库，LangChain 用它把 schema 转成 OpenAI 格式的函数定义
import { z } from 'zod';

// 初始化聊天模型（连接 DeepSeek 服务）
const model = new ChatOpenAI({
  // API 密钥，来自 .env 的 DEEPSEEK_API
  apiKey: process.env.DEEPSEEK_API,
  // 模型名称，来自 .env 的 MODEL_NAME
  modelName: process.env.MODEL_NAME,
  // 温度设为 0：输出更确定、更严格遵循指令（适合工具调用场景）
  temperature: 0,
  configuration: {
    // API 接口地址，来自 .env 的 BASE_URL
    baseURL: process.env.BASE_URL,
  },
});

// 定义工具：read_file —— 读取指定路径的文件内容
// tool() 接收两个参数：
//   1. 执行函数：真正干活的代码。参数 { filePath } 是模型按 schema 生成、经校验后的值
//   2. 元信息：name（模型引用工具的名字）、description（模型决定何时使用的依据）、
//      schema（声明参数结构，模型据此生成合法的调用参数）
// 再次强调：工具函数是"我们自己调用的"，模型只负责"提出调用请求"（tool_calls）
const readFileTool = tool(
    // 模型调用参数会按 schema 解析后作为对象传入，这里直接解构出 filePath
    async ({filePath}) => {
        // 按 utf-8 读取文件内容（相对路径相对于当前工作目录）
        const content = await fs.readFile(filePath, 'utf-8');
        // 打印调用日志，方便观察 Agent 的调用过程
        console.log(`[工具调用]:read_file(${filePath})-成功读取 ${content.length} 字节`);
        // 返回值 = 工具执行结果，会以 ToolMessage 的形式回传给模型
        return `文件内容:\n${content}`;
    },
    {
        // 工具名：模型在 tool_calls 里用这个名字指定调用哪个工具
        name: 'read_file',
        // 工具描述：模型根据"读文件"这个需求匹配到本工具
        description: '用此工具来读取文件内容。当用户要求读取文件、查看代码、分析文件内容时，调用此工具。输入文件路径（可以是相对路径或绝对路径）。',
        // 参数 schema：声明工具需要一个字符串参数 filePath（zod 负责校验）
        schema: z.object({
            filePath: z.string().describe('要读取的文件路径'),
        })
    }
)

// 收集所有工具，供 bindTools 声明和循环里的"按名查找"使用
const tools = [readFileTool];

// bindTools()：把工具列表"告诉"模型 —— 模型此后知道存在 read_file，并能生成调用请求。
// 注意：bindTools 只做声明，工具【不会】自动执行，执行要靠下面的循环。
// （@langchain/core 1.2.11 里没有 withTools 方法，这里用 bindTools）
const modelWithTools = model.bindTools(tools);

// 对话消息列表：按顺序组成完整上下文，每次 invoke 都把整个列表发给模型
const messages = [
    // 系统消息：定义模型的角色、工作流程和可用工具（由开发者写，用户看不见）
    new SystemMessage(`
        你是一个代码助手，可以使用工具读取文件并解释代码。
        工作流程：
        1. 用户要求读取文件时，立即调用 read_file 工具
        2. 等待工具返回文件内容
        3. 基于文件内容进行分析和解释
        可用工具：
        - read_file: 读取文件内容（使用此工具来获取文件内容）
    `),
    // 用户消息：本次要完成的任务
    new HumanMessage("请读取 src/tool-file-read.mjs 文件，并解释代码的功能。"),
]

// 第一轮调用：让模型根据系统提示决定"是否要调用工具"
let response = await modelWithTools.invoke(messages);

// ============================================================
// 工具调用循环（Agent 的核心机制）
// 流程：模型返回 tool_calls（调用请求）-> 我们执行工具 -> 结果以 ToolMessage 回传
//       -> 重新 invoke -> 模型要么继续调用工具、要么给出最终文字回复
// 结束条件：模型不再返回 tool_calls（response.tool_calls 为空或 undefined）
// ============================================================
while (response.tool_calls && response.tool_calls.length > 0) {
    // 把带 tool_calls 的模型回复加入消息列表（保留历史，防止模型"失忆"）
    messages.push(response);
    // 模型可能在同一轮里请求调用多个工具，逐个执行
    for (const toolCall of response.tool_calls) {
        // toolCall 结构：{ id: 调用ID, name: 工具名, args: 参数对象 }
        // 按名字在工具列表里找到对应的工具对象
        const matchedTool = tools.find((t) => t.name === toolCall.name);
        // 稳健性处理：模型请求了不存在的工具时，把"未知工具"作为结果回传而不是崩溃
        if (!matchedTool) {
            messages.push(new ToolMessage({ tool_call_id: toolCall.id, content: `未知工具: ${toolCall.name}` }));
            continue;
        }
        // 真正执行工具函数：toolCall.args 会经 schema 校验后传给工具函数
        const toolResult = await matchedTool.invoke(toolCall.args);
        // 工具结果回传模型。tool_call_id 必须与 toolCall.id 一一对应，
        // 模型靠它把"这次的执行结果"关联到"自己刚才的调用请求"
        messages.push(new ToolMessage({ tool_call_id: toolCall.id, content: toolResult }));
    }
    // 把"用户 + 工具执行结果"的新上下文再发给模型，进入下一轮
    response = await modelWithTools.invoke(messages);
}

// 循环退出时，response 是模型不再调用工具的最终文字回复
console.log("模型输出:\n", response.content);