// DeepSeek API 不支持默认的 json_schema response_format
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { toJsonSchema } from '@langchain/core/utils/json_schema';

const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API,
  modelName: process.env.MODEL_NAME,
  temperature: 0,
  configuration: {
    baseURL: process.env.BASE_URL,
  },
});

// 定义结构化输出的 schema
const scientistSchema = z.object({
  name: z.string().describe("科学家的全名"),
  birth_year: z.number().describe("出生年份"),
  nationality: z.string().describe("国籍"),
  fields: z.array(z.string()).describe("研究领域列表"),
});

// 注意：DeepSeek 网关仅支持 jsonMode 策略（response_format.type = "json_object"）
// 默认的 jsonSchema 策略会导致 400 错误，因此显式指定 { method: 'jsonMode' }
const structuredModel = model.withStructuredOutput(scientistSchema, { method: 'jsonMode' });

// jsonMode 只保证输出合法 JSON，不保证字段名与 schema 一致，
// 需把 toJsonSchema(schema) 的结果写进 prompt 约束字段名
const prompt = `介绍一下爱因斯坦。

必须严格输出符合以下 JSON Schema 的 JSON 对象，字段名必须完全一致，不要增加或修改字段：
${JSON.stringify(toJsonSchema(scientistSchema), null, 2)}

请直接返回 JSON 数据，不要包含任何解释性文字。`;

// 调用模型
const result = await structuredModel.invoke(prompt);

console.log("结构化结果:", JSON.stringify(result, null, 2));
console.log(`\n姓名: ${result.name}`);
console.log(`出生年份: ${result.birth_year}`);
console.log(`国籍: ${result.nationality}`);
console.log(`研究领域: ${result.fields.join(', ')}`);