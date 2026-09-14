/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-14 22:40:11
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-14 23:00:03
 * @FilePath: /ai agent learning/1. tool-test/src/tool-file-read.mjs
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */

// 自动加载 `.env` 文件中的环境变量
import 'dotenv/config';
// LangChain 对 OpenAI 接口的封装
import { ChatOpenAI } from "@langchain/openai";
// LangChain 用来把普通函数包装成"可被模型调用的工具"
import { tool } from '@langchain/core/tools';
// LangChain 消型定义, HumanMessage 用户消息, SystemMessage 系统消息, ToolMessage 工具消息, AIMessage 模型回复消息
import { HumanMessage, SystemMessage, ToolMessage, AIMessage } from '@langchain/core/messages';
// Node.js 文件系统模块
import fs from 'node:fs/promises';
// 数据校验库
import { z } from 'zod';

// 初始化模型
const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API,
  modelName: process.env.MODEL_NAME,
  // 温度 0，严格按照指令
  temperature: 0,
  configuration: {
    baseURL: process.env.BASE_URL,
  },
});

// 定义一个工具，用于读取文件内容
// 该工具的 schema 定义了工具的输入参数（ filePath），以及工具的描述（用此工具来读取文件内容）
// 当用户要求读取文件、查看代码、分析文件内容时，调用此工具。输入文件路径（可以是相对路径或绝对路径）。
const readFileTool = tool(
    async ({filePath}) => {
        const content = await fs.readFile(filePath, 'utf-8');
        console.log(`[工具调用]:read_file(${filePath})-成功读取 ${content.length} 字节`);
        return `文件内容:\n${content}`;
    },
    {
        name: 'read_file',
        description: '用此工具来读取文件内容。当用户要求读取文件、查看代码、分析文件内容时，调用此工具。输入文件路径（可以是相对路径或绝对路径）。',
        schema: z.object({
            filePath: z.string().describe('要读取的文件路径'),
        })
    }
)

// 绑定工具到模型
const tools = [readFileTool];

// 当前版本（@langchain/core 1.2.11）没有 withTools 方法，用 bindTools 绑定工具；
// 工具不会自动执行，需要下面的循环手动执行并把结果回传给模型
const modelWithTools = model.bindTools(tools);

const messages = [
    new SystemMessage(`
        你是一个代码助手，可以使用工具读取文件并解释代码。
        工作流程：
        1. 用户要求读取文件时，立即调用 read_file 工具
        2. 等待工具返回文件内容
        3. 基于文件内容进行分析和解释
        可用工具：
        - read_file: 读取文件内容（使用此工具来获取文件内容）
    `),
    new HumanMessage("请读取 src/tool-file-read.mjs 文件，并解释代码的功能。"),
]

let response = await modelWithTools.invoke(messages);

// 工具调用循环：只要模型返回了 tool_calls，就执行工具、把结果作为 ToolMessage 回传，
// 再让模型继续，直到模型直接给出文字回答
while (response.tool_calls && response.tool_calls.length > 0) {
    messages.push(response);
    for (const toolCall of response.tool_calls) {
        const matchedTool = tools.find((t) => t.name === toolCall.name);
        if (!matchedTool) {
            messages.push(new ToolMessage({ tool_call_id: toolCall.id, content: `未知工具: ${toolCall.name}` }));
            continue;
        }
        const toolResult = await matchedTool.invoke(toolCall.args);
        messages.push(new ToolMessage({ tool_call_id: toolCall.id, content: toolResult }));
    }
    response = await modelWithTools.invoke(messages);
}

console.log("模型输出:\n", response.content);