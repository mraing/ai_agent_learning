import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { z } from 'zod';
import mysql from 'mysql2/promise';

// 初始化模型
const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API,
  modelName: process.env.MODEL_NAME,
  temperature: 0,
  // 多个人物信息较长，给足输出长度，避免 JSON 被截断导致解析失败
  maxTokens: 2048,
  configuration: {
    baseURL: process.env.BASE_URL,
  },
});

// 定义单个好友信息的 zod schema，匹配 friends 表结构
const friendSchema = z.object({
  name: z.string().describe('姓名'),
  gender: z.string().describe('性别（男/女）'),
  birth_date: z.string().describe('出生日期，格式：YYYY-MM-DD，如果无法确定具体日期，根据年龄估算'),
  company: z.string().nullable().describe('公司名称，如果没有则返回 null'),
  title: z.string().nullable().describe('职位/头衔，如果没有则返回 null'),
  phone: z.string().nullable().describe('手机号，如果没有则返回 null'),
  wechat: z.string().nullable().describe('微信号，如果没有则返回 null'),
});

// 定义批量好友信息的 schema
// 注意：必须用对象包裹数组。JSON Schema 与 function calling 都要求顶层是 object，
// 顶层直接是 array 会被服务端拒绝（schema must be a JSON Schema of 'type: "object"'）。
const wrapperSchema = z.object({
  friends: z.array(friendSchema).describe('好友信息数组'),
});

// 使用 withStructuredOutput 方法
// 当前服务端（api.deepseek.com + deepseek-flash）不支持 response_format.type = "json_schema"
// （会返回 400 This response_format type is unavailable now），也不支持强制 tool_choice
// （thinking 模式只接受 "auto"），因此这里显式使用 jsonMode（response_format.type = "json_object"）。
const structuredModel = model.withStructuredOutput(wrapperSchema, { method: 'jsonMode' });

// 数据库连接配置
const connectionConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'admin',
  multipleStatements: true,
};

async function extractAndInsert(text) {
  const connection = await mysql.createConnection(connectionConfig);

  try {
    // 切换到 hello 数据库
    await connection.query(`USE hello;`);

    // 使用 AI 提取结构化信息
    console.log('🤔 正在从文本中提取信息...\n');
    // jsonMode 只保证输出合法 JSON，不保证字段名与 schema 一致，
    // 所以必须把 JSON Schema 显式写进 prompt，否则模型会自造 age / position 等字段。
    const prompt = `请从下面的文本中提取所有好友信息。

必须严格输出符合以下 JSON Schema 的 JSON 对象，字段名必须完全一致，不要增加 age、position 等其它字段：
${JSON.stringify(toJsonSchema(wrapperSchema), null, 2)}

要求：
1. 文本中有几个人，friends 数组就有几个元素
2. birth_date 无法确定具体日期时，按年龄描述估算（如"30出头" -> 约 1994 年生）
3. 缺失的字段用 null，不要编造

文本：
${text}`;

    const { friends: results } = await structuredModel.invoke(prompt);

    console.log(`✅ 提取到 ${results.length} 条结构化信息:`);
    console.log(JSON.stringify(results, null, 2));
    console.log('');

    if (results.length === 0) {
      console.log('⚠️  没有提取到任何信息');
      return { count: 0, insertIds: [] };
    }

    // 批量插入数据库
    const insertSql = `
      INSERT INTO friends (
        name,
        gender,
        birth_date,
        company,
        title,
        phone,
        wechat
      ) VALUES ?;
    `;

    const values = results.map((result) => [
      result.name,
      result.gender,
      result.birth_date || null,
      result.company,
      result.title,
      result.phone,
      result.wechat,
    ]);

    const [insertResult] = await connection.query(insertSql, [values]);
    console.log(`✅ 成功批量插入 ${insertResult.affectedRows} 条数据`);
    console.log(`   插入的ID范围：${insertResult.insertId} - ${insertResult.insertId + insertResult.affectedRows - 1}`);

    return {
      count: insertResult.affectedRows,
      insertIds: Array.from({ length: insertResult.affectedRows }, (_, i) => insertResult.insertId + i),
    };
  } catch (err) {
    console.error('❌ 执行出错：', err);
    throw err;
  } finally {
    await connection.end();
  }
}

// 主函数
async function main() {
  // 示例文本（包含多个人的信息）
  const sampleText = `我最近认识了几个新朋友。第一个是张总，女的，看起来30出头，在腾讯做技术总监，手机13800138000，微信是zhangzong2024。第二个是李工，男，大概28岁，在阿里云做架构师，电话15900159000，微信号lee_arch。还有一个是陈经理，女，35岁左右，在美团做产品经理，手机号是18800188000，微信chenpm2024。`;

  console.log('📝 输入文本:');
  console.log(sampleText);
  console.log('');

  try {
    const result = await extractAndInsert(sampleText);
    console.log(`\n🎉 处理完成！成功插入 ${result.count} 条记录`);
    console.log(`   插入的ID：${result.insertIds.join(', ')}`);
  } catch (error) {
    console.error('❌ 处理失败：', error.message);
    process.exit(1);
  }
}

main();