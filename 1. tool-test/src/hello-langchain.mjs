// ============================================================
// hello-langchain.mjs —— LangChain 第一个示例（Hello World）
//
// 功能：用 LangChain 调用 DeepSeek 大模型，问一句"介绍下自己"并打印回答
// 运行：node src/hello-langchain.mjs
// 前置：项目根目录的 .env 已配置 DEEPSEEK_API / BASE_URL / MODEL_NAME
// ============================================================

// ChatOpenAI：@langchain/openai 对"OpenAI 兼容接口"的封装类。
// DeepSeek、通义千问、智谱等国产模型都提供 OpenAI 兼容 API，
// 所以只需切换 apiKey 和 baseURL，就能用同一个类对接不同厂商的模型。
import { ChatOpenAI } from "@langchain/openai";

// dotenv：把 .env 文件中的配置读入 process.env 的小工具。
// 作用：让 API 密钥这类敏感信息不写死在代码里（.env 已被 .gitignore 忽略，不会上传到 Git）。
import dotenv from "dotenv";

// 加载 .env 文件中的环境变量，必须在读取 process.env.XXX 之前调用
dotenv.config(); 

// 创建聊天模型实例：相当于建立与模型服务的连接
const model = new ChatOpenAI({
  // API 密钥，来自 .env 的 DEEPSEEK_API
  apiKey: process.env.DEEPSEEK_API,
  // 模型名称，来自 .env 的 MODEL_NAME（例如 deepseek-flash）
  modelName: process.env.MODEL_NAME,
  configuration: {
    // API 接口地址，来自 .env 的 BASE_URL（官方地址 https://api.deepseek.com）
    baseURL: process.env.BASE_URL,
  },
});

// invoke() 是 LangChain 的调用入口：发送一条消息，等待模型回复。
// "介绍下自己" 会作为 user 角色的消息发给模型
const response = await model.invoke("介绍下自己");

// 返回的是一个 AIMessage 对象，.content 保存模型生成的文本内容
console.log(response.content);