<!--
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-17 21:08:15
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-17 21:11:11
 * @FilePath: /ai agent learning/README.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
# AI Agent 学习仓库

LangChain + DeepSeek 等 AI Agent 实验代码集合（`1. tool-test`、`2. rag-test`），
提交信息遵循 Conventional Commits 规范（`type(scope): 中文描述`）。

## 目录

- `1. tool-test/` —— MCP 工具调用、文件读写等工具测试脚本
- `2. rag-test/` —— RAG 检索测试项目（向量库、索引构建示例）
- `3. milvus-test/` —— Milvus 向量数据库测试
- `4. memory-test/` —— 会话记忆/上下文记忆测试
- `5. output-parser-test/` —— 输出解析测试（结构化输出、JSON/XML/Tool Calls 流式解析、智能导入、mini-cursor Agent）
- `25. agui/` —— AG-UI 前后端演示：`agui-backend/`（NestJS，`POST /ai/chat` 流式接口）+ `agui-frontend/`（React + Vite，`@ai-sdk/react` 的 `useChat` 消费流式响应，Streamdown 渲染 Markdown/代码高亮/Mermaid）
- `26.langgraph-test/` —— LangGraph 入门实验（`src/1.`～`7.`：StateGraph、条件路由、checkpointer、interrupt、预置 ToolNode/Agent、多 Agent Supervisor）；第 7 章配[图解教学笔记](26.langgraph-test/docs/7-supervisor-教学.md)
- `27.advanced-rag/` —— 高级 RAG 实验（`src/`：`1.naive-rag.mjs` 检索→生成基础流水线、`rag-query-router.mjs` 查询路由（simple 直答 / complex 检索）、`rag-multihop.mjs` 多跳问题拆解为有序子问题逐轮检索、`rag-webfallback.mjs` 本地检索不足时联网搜索兜底）；四个脚本均带中文教学注释
- `29.es-test/` —— Elasticsearch 8.17 + IK 中文分词（`elasticsearch/Dockerfile` 自行构建镜像）、Kibana、Milvus 一体化实验环境（`docker-compose.yml`）；`src/` 含 ES 基础增删改查（`create.mjs`/`operate.mjs`）、RAG 混合检索与查询改写（`rag/`）、DashScope 重排（`rerank/`）


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

### Structured Output 兼容性注意（DeepSeek 网关）

当前 `api.deepseek.com` 网关（`deepseek-flash`、`deepseek-v4-pro`）只支持 `response_format.type = "json_object"`：

- 不支持 `response_format.type = "json_schema"`，会报 `400 This response_format type is unavailable now`。
  因此 `withStructuredOutput(schema)` 默认的 `jsonSchema` 策略不可用，需显式指定 `{ method: 'jsonMode' }`。
- 不支持强制 `tool_choice`，thinking 模式下会报 `400 Thinking mode does not support this tool_choice`，
  因此 `functionCalling` 策略不可用。
- function calling / JSON Schema 要求顶层为 `object`，顶层直接是数组会报
  `schema must be a JSON Schema of 'type: "object"'`，数组需用一个对象字段包裹。
- `jsonMode` 只保证输出合法 JSON，不保证字段名与 schema 一致，
  需把 `toJsonSchema(schema)` 的结果写进 prompt 约束字段名。

### mini-cursor Agent 说明

`5. output-parser-test/src/test/mini-cursor.mjs` 是 `1. tool-test/src/mini-cursor.mjs` 的流式版本：
用 `JsonOutputToolsParser` 边生成边解析 tool call，从而把 `write_file` 的 `content` 参数
实时增量打印出来（写长文件时能看到进度）。

- 它依赖同目录的 `all-tools.mjs`（从 `1. tool-test/src/` 复制而来，两边保持独立）。
- 模型配置统一走本项目的 `.env`（`DEEPSEEK_API` / `BASE_URL` / `MODEL_NAME`）。
- 注意：thinking 模型（`deepseek-flash`）的思维链在 `additional_kwargs.reasoning_content` 中下发，
  此时 `chunk.content` 为空字符串。判断"是否有文本输出"必须只看 `content`，
  否则会把思维链打印到终端。


### 安装Milvus
```
docker run -d --name milvus -p 19530:19530 -p 29530:29530 -v milvus-data:/var/lib/milvus milvus:latest
```

### 安装Attu
```
docker run -d --name attu -p 3000:3000 -v attu-data:/data zilliz/attu:v3.0.0-beta.6
```

### 连接Milvus数据库
```
连接 milvus 数据库: host.docker.internal:19530
```

### 下载MySQL
```
docker pull mysql:8.0.33
```

### 启动MySQL
1. 临时跑一下，容器删除后数据会丢失
```
docker run -d \
  --name mysql8 \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -p 3306:3306 \
  mysql:8.0
```

2. 持久化数据
```
# 1. 先在宿主机创建目录
mkdir -p ~/docker/mysql/{data,conf,logs}

# 2. 启动容器
docker run -d \
  --name mysql8 \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -e MYSQL_DATABASE=testdb \
  -v ~/docker/mysql/data:/var/lib/mysql \
  -v ~/docker/mysql/conf:/etc/mysql/conf.d \
  -v ~/docker/mysql/logs:/var/log/mysql \
  mysql:8.0 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci
```

参数说明：

-e MYSQL_ROOT_PASSWORD：必须设置，root 用户的密码。

-e MYSQL_DATABASE：可选，启动时自动创建的数据库名。

-v ...:/var/lib/mysql：核心挂载，将数据持久化到宿主机，避免容器删除后数据丢失。

--character-set-server=utf8mb4：设置字符集，避免中文乱码。

### ES 镜像拉取超时（Docker Hub 国内不可达）

`29.es-test` 首次 `docker compose up -d` 时可能报：

```
failed to solve: DeadlineExceeded: failed to fetch anonymous token:
Get "https://auth.docker.io/token?scope=repository%3Alibrary%2Felasticsearch%3Apull...": dial tcp ...: i/o timeout
```

这是 `auth.docker.io` / `registry-1.docker.io` 在当前网络下不通导致的，与镜像本身无关。处理方式：

1. ES 基础镜像已改用 Elastic 官方仓库（内容与 Docker Hub 上的一致，且同时提供 amd64/arm64）：

```
ARG ES_IMAGE=docker.elastic.co/elasticsearch/elasticsearch:8.17.0
FROM ${ES_IMAGE}
```

需要换回 Docker Hub 或走加速器时：
`docker compose build --build-arg ES_IMAGE=<registry>/library/elasticsearch:8.17.0`

2. 其余镜像（`kibana`、`minio/minio`、`milvusdb/milvus`）仍来自 Docker Hub，可在
   Docker Desktop → Settings → Docker Engine 里配置镜像加速器（保存后需重启 Docker 生效）：

```json
{
  "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1ms.run"]
}
```

3. 本项目 `docker-compose.yml` 里的 `minio`（9000/9001）和 `standalone`（19530/9091）端口，
   与 `~/Documents/milvus-docker` 那套 Milvus 栈冲突；只想用 ES 时执行
   `docker compose up -d es kibana` 即可。