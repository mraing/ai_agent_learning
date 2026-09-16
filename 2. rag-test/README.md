# 2. rag-test

LangChain.js 的 RAG（检索增强生成）练习项目：加载文档 → 切分 → 向量化 → 检索 → 交给 LLM 生成回答。

## 环境要求

- Node.js >= 18（项目实际在 v24 上验证）
- pnpm

## 安装

```bash
pnpm install
```

## 配置

复制 `.env` 并填入自己的密钥，共四个变量：

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API` | 对话模型（LLM）的 API Key |
| `BASE_URL` | LLM 服务的基础地址，如 `https://api.deepseek.com` |
| `MODEL_NAME` | LLM 模型名，如 `deepseek-flash` |
| `EMBEDDING_MODEL_API` | 向量模型（embedding）的 API Key |
| `EMBEDDING_MODEL_URL` | 向量服务**基础地址**，如 `https://api.siliconflow.cn/v1` |
| `EMBEDDING_MODEL_NAME` | 向量模型名，如 `Qwen/Qwen3-Embedding-8B` |

> ⚠️ **`BASE_URL` / `EMBEDDING_MODEL_URL` 只写到 `/v1`，不要带 `/embeddings` 或 `/chat/completions`。**
> LangChain 的 OpenAI 兼容客户端会自己在基础地址后拼接接口路径。若基础地址里已经带了
> `/embeddings`，实际请求会变成 `/v1/embeddings/embeddings`，服务端返回 **404**。
> 报错栈会指向 `@langchain/openai/dist/embeddings.js`，但根因在环境变量。

## 运行

```bash
node ./src/hello-rag.mjs           # 完整 RAG 流程示例
node ./src/loader-and-splitter.mjs # 网页加载 + 文本切分示例
```

各脚本的详细说明见 [`src/README.md`](./src/README.md)。

## 目录结构

```
2. rag-test/
├── .env                    # 密钥与模型配置（已被 .gitignore 忽略，不要提交）
├── package.json
├── pnpm-lock.yaml
├── README.md               # 本文件
└── src/                    # 示例脚本，详见 src/README.md
```

## 技术栈

| 包 | 用途 |
| --- | --- |
| `@langchain/core` | 核心抽象：`Document`、向量存储接口等 |
| `@langchain/openai` | `ChatOpenAI` 与 `OpenAIEmbeddings`（兼容 OpenAI 协议的第三方服务） |
| `@langchain/classic` | `MemoryVectorStore` 等经典组件 |
| `@langchain/community` | 社区集成，如 `CheerioWebBaseLoader` 网页加载器 |
| `@langchain/textsplitters` | `RecursiveCharacterTextSplitter` 等文本切分器 |
| `cheerio` | 服务端 HTML 解析（配合网页加载器） |
| `dotenv` | 从 `.env` 读取环境变量 |

## 常见问题

**`ERR_MODULE_NOT_FOUND: Cannot find package '@langchain/textsplitter'`**
包名拼写错误，正确名称是 `@langchain/textsplitters`（结尾有 `s`）。

**`NotFoundError: 404` / `lc_error_code: 'MODEL_NOT_FOUND'`**
优先检查 `BASE_URL` / `EMBEDDING_MODEL_URL` 是否多写了接口路径，见上文配置说明。

**`pnpm install <包名>` 显示 "Already up to date"**
`pnpm install` 只用于按锁文件安装已有依赖，不会新增依赖。新增请用 `pnpm add <包名>`。
