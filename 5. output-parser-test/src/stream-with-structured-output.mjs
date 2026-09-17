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

// 使用 zod 定义结构化输出格式
const schema = z.object({
  name: z.string().describe("姓名"),
  birth_year: z.number().describe("出生年份"),
  death_year: z.number().describe("去世年份"),
  nationality: z.string().describe("国籍"),
  occupation: z.string().describe("职业"),
  famous_works: z.array(z.string()).describe("著名作品列表"),
  biography: z.string().describe("简短传记")
});

// 注意：DeepSeek 网关仅支持 jsonMode 策略（response_format.type = "json_object"）
// 默认的 jsonSchema 策略会导致 400 错误，因此显式指定 { method: 'jsonMode' }
const structuredModel = model.withStructuredOutput(schema, { method: 'jsonMode' });

// jsonMode 只保证输出合法 JSON，不保证字段名与 schema 一致，
// 需把 toJsonSchema(schema) 的结果写进 prompt 约束字段名
const prompt = `详细介绍莫扎特的信息。

必须严格输出符合以下 JSON Schema 的 JSON 对象，字段名必须完全一致，不要增加或修改字段：
${JSON.stringify(toJsonSchema(schema), null, 2)}

请直接返回 JSON 数据，不要包含任何解释性文字。`;

console.log("🌊 流式结构化输出演示（withStructuredOutput - jsonMode 兼容 DeepSeek）\n");

try {
  const stream = await structuredModel.stream(prompt);

  let chunkCount = 0;
  let result = null;

  console.log("📡 接收流式数据:\n");

  for await(const chunk of stream) {
    chunkCount++;
    result = chunk;

    console.log(`[Chunk ${chunkCount}]`);
    console.log(JSON.stringify(chunk, null, 2));
  }

  console.log(`\n✅ 共接收 ${chunkCount} 个数据块\n`);

  if (result) {
    console.log("📊 最终结构化结果:\n");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n📝 格式化输出:");
    console.log(`姓名: ${result.name}`);
    console.log(`出生年份: ${result.birth_year}`);
    console.log(`去世年份: ${result.death_year}`);
    console.log(`国籍: ${result.nationality}`);
    console.log(`职业: ${result.occupation}`);
    console.log(`著名作品: ${result.famous_works.join(', ')}`);
    console.log(`传记: ${result.biography}`);
  }

} catch (error) {
  console.error("\n❌ 错误:", error.message);
}