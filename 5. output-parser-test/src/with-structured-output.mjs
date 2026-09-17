import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

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

// 使用 withStructuredOutput 方法
// DeepSeek API 不支持默认的 json_schema response_format，改用 jsonMode（json_object）
const structuredModel = model.withStructuredOutput(scientistSchema, { method: 'jsonMode' });

// 调用模型（jsonMode 要求提示词含 "json" 字样，需同时明确字段名）
const result = await structuredModel.invoke("用 JSON 格式介绍爱因斯坦，字段: name(全名), birth_year(出生年份,数字), nationality(国籍), fields(研究领域数组)");

console.log("结构化结果:", JSON.stringify(result, null, 2));
console.log(`\n姓名: ${result.name}`);
console.log(`出生年份: ${result.birth_year}`);
console.log(`国籍: ${result.nationality}`);
console.log(`研究领域: ${result.fields.join(', ')}`);