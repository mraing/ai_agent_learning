# AI Agent 学习仓库

LangChain + DeepSeek 等 AI Agent 实验代码集合（`1. tool-test`、`2. rag-test`），
提交信息遵循 Conventional Commits 规范（`type(scope): 中文描述`）。

## 目录

- `1. tool-test/` —— MCP 工具调用、文件读写等工具测试脚本
- `2. rag-test/` —— RAG 检索测试项目（向量库、索引构建示例）
- `3. milvus-test/` —— Milvus 向量数据库测试


```js
const model = new ChatOpenAI({
  apiKey: process.env.DEEPSEEK_API,
  modelName: process.env.MODEL_NAME,
  temperature: 0,
  configuration: {
    baseURL: process.env.BASE_URL,
  },
});

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.EMBEDDING_MODEL_API,
  modelName: process.env.EMBEDDING_MODEL_NAME,
  configuration: {
    baseURL: process.env.EMBEDDING_MODEL_URL,
  },
  dimensions: VECTOR_DIM,
});
```