/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-15 22:16:29
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-15 22:23:17
 * @FilePath: /ai agent learning/1. tool-test/src/mcp-test.mjs
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import 'dotenv/config';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { ChatOpenAI } from '@langchain/openai';
import chalk from 'chalk';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API, // API 密钥（来自 .env）
  modelName: process.env.MODEL_NAME, // 模型名（来自 .env，如 deepseek-flash）
  temperature: 0, // 温度 0：行为更确定，减少发挥偏差
  configuration: {
    baseURL: process.env.BASE_URL, // DeepSeek 接口地址（来自 .env）
  },
});

const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    'my-mcp-server': {
      command: "node",
      args: [
        "src/my-mcp-server.mjs"
      ]
    },
    "amap-maps-streamableHTTP": {
      "url": "https://mcp.amap.com/mcp?key=" + process.env.AMAP_MAPS_API_KEY
    },
  }
});

const tools = await mcpClient.getTools();
const modelWithTools = model.bindTools(tools);

async function runAgentWithTools(query, maxIterations = 30) {
  const messages = [
    new HumanMessage(query)
  ];

  for (let i = 0; i < maxIterations; i++) {
    console.log(chalk.bgGreen(`⏳ 正在等待 AI 思考...`));
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    // 检查是否有工具调用
    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${response.content}\n`);
      return response.content;
    }

    console.log(chalk.bgBlue(`🔍 检测到 ${response.tool_calls.length} 个工具调用`));
    console.log(chalk.bgBlue(`🔍 工具调用: ${response.tool_calls.map(t => t.name).join(', ')}`));
    // 执行工具调用
    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find(t => t.name === toolCall.name);
      if (foundTool) {
        let toolResult;
        try {
          toolResult = await foundTool.invoke(toolCall.args);
        } catch (error) {
          // MCP 服务端返回错误（如高德配额超限）时，mcp-adapters 会抛 ToolException。
          // 捕获后把错误信息回传给模型，让模型自己决定下一步，而不是整个脚本崩溃。
          toolResult = `工具调用失败: ${error.message}`;
        }

        messages.push(new ToolMessage({
          content: toolResult,
          tool_call_id: toolCall.id,
        }));
      }
    }
  }

  return messages[messages.length - 1].content;
}


await runAgentWithTools("北京南站附近的酒店，以及去的路线");

await mcpClient.close();