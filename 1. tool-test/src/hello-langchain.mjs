// 这是一个使用LangChain和OpenAI聊天API的简单示例。
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";

// 加载 .env 文件中的环境变量
dotenv.config(); 

const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API,
  modelName: process.env.MODEL_NAME,
  configuration: {
    baseURL: process.env.BASE_URL,
  },
});

const response = await model.invoke("介绍下自己");

console.log(response.content);


