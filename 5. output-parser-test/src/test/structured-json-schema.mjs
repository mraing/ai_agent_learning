/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-17 22:04:25
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-17 22:38:10
 * @FilePath: /ai agent learning/5. output-parser-test/src/test/structured-json-schema.mjs
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import chalk from 'chalk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// 定义科学家信息的 Zod Schema
const scientistSchema = z.object({
    name: z.string().describe("科学家的全名"),
    birth_year: z.number().describe("出生年份"),
    field: z.string().describe("主要研究领域"),
    achievements: z.array(z.string()).describe("主要成就列表")
}).strict();

// 将 Zod 转换为 JSON Schema 格式，用于写入 prompt 约束字段名
const nativeJsonSchema = zodToJsonSchema(scientistSchema);

// 注意：DeepSeek 网关（api.deepseek.com）仅支持 response_format.type = "json_object"
// 不支持 "json_schema"（会报 400 This response_format type is unavailable now）
// 因此使用 json_object 模式，并将 JSON Schema 写入 prompt 约束字段名
const model = new ChatOpenAI({
    modelName: "qwen-max",
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY,
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
    },
    modelKwargs: {
        // 使用兼容的 json_object 模式
        response_format: {
            type: "json_object"
        }
    }
});

async function testNativeJsonSchema() {
    console.log(chalk.bgMagenta("🧪 测试 JSON Object 模式（兼容 DeepSeek 网关）...\n"));

    // 将 JSON Schema 写入 SystemMessage，约束输出字段名和格式
    // 因为 jsonMode/json_object 只保证输出合法 JSON，不保证字段名与 schema 一致
    const res = await model.invoke([
        new SystemMessage(`你是一个信息提取助手，请严格按照以下要求返回 JSON 数据：

必须严格输出符合以下 JSON Schema 的 JSON 对象，字段名必须完全一致，不要增加或修改字段：
${JSON.stringify(nativeJsonSchema, null, 2)}

请直接返回 JSON 数据，不要包含任何解释性文字。`),
        new HumanMessage("介绍一下杨振宁")
    ]);

    console.log(chalk.green("\n✅ 收到响应 (纯净 JSON):"));
    console.log(res.content); 

    const data = JSON.parse(res.content);
    console.log(chalk.cyan("\n📋 解析后的对象:"));
    console.log(data);
}

testNativeJsonSchema().catch(console.error);