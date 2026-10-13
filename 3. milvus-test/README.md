# 3. milvus-test

Milvus 向量数据库 + LangChain.js 的练习项目：把日记文本向量化后存入 Milvus，供后续向量检索。

## 环境要求

- Node.js（项目在 v24 上验证）
- pnpm
- 本机已启动 Milvus Standalone（默认端口 `localhost:19530`），可配合 **Attu**（Milvus 的 Web 管理界面）查看数据

## 安装与配置

```bash
pnpm install
```

复制 `.env` 并填入密钥，关键变量（与 `2. rag-test` 共用一套向量服务）：

| 变量 | 说明 |
| --- | --- |
| `EMBEDDING_MODEL_API` | 向量模型 API Key |
| `EMBEDDING_MODEL_URL` | 向量服务基础地址，如 `https://api.siliconflow.cn/v1`（**不要**带 `/embeddings`） |
| `EMBEDDING_MODEL_NAME` | 向量模型名，如 `Qwen/Qwen3-Embedding-8B` |

## 运行

### 日记示例：`insert.mjs`

```bash
node ./src/insert.mjs
```

脚本做的事：

1. 连接 Milvus；
2. 创建集合 `ai_diary`（主键 `id` + 1024 维 `vector` + `content`/`date`/`mood`/`tags` 元数据字段）；
3. 为 `vector` 建 IVF_FLAT/COSINE 索引并加载集合；
4. 把 5 条中文日记逐条向量化（模型输出被截断为 1024 维，与集合维度一致）；
5. 插入并 `flush` 落盘，最后可在 Attu 中查看。

### 电子书 RAG：先入库，再检索/问答

《天龙八部》这条链路分成**两个脚本**，顺序不能颠倒：

```bash
# 1) 先入库：创建 ebook_collection，切分 epub 并向量化写入（约 3051 个片段，需 55 章逐章调用 embedding API）
node ./src/ebook-writer.mjs

# 2) 再检索/问答：Reader RAG 会读取第 1 步写入的数据
node ./src/ebook-reader-rag.mjs
```

- `ebook-writer.mjs`：`epub` → 按章拆分 → 每 500 字符切块（重叠 50）→ 1024 维向量 → 写入 `ebook_collection`。
- `ebook-reader-rag.mjs`：问题向量化 → 在 `ebook_collection` 中 COSINE 检索 Top-K → 拼上下文交给 LLM 回答。
- `ebook-query.mjs`：只做向量检索、不调 LLM，适合排查“检索是否命中”。

> ⚠️ `ebook-reader-rag.mjs` 和 `ebook-query.mjs` **不会创建集合**，它们假定 `ebook_collection` 及其数据已存在。请先完整跑完 `ebook-writer.mjs`。

## 常见问题

**报 `CollectionNotExists ... collection=ebook_collection`？**
说明数据还没入库——集合从未创建（不是数据被清空）。按顺序处理：

1. 确认你连的 Milvus 里有没有这个集合（在 `3. milvus-test/` 目录下执行）：

   ```bash
   node -e "const{MilvusClient}=require('@zilliz/milvus2-sdk-node');new MilvusClient({address:'localhost:19530'}).listCollections().then(r=>console.log(r.collection_names))"
   ```

   只列出 `[ 'ai_diary' ]` 就说明 `ebook_collection` 确实没建过，需要走第 2 步。

2. 运行 `node ./src/ebook-writer.mjs` 创建集合并灌数据（首次会创建集合 + IVF_FLAT/COSINE 索引）。
3. 之后再运行 `node ./src/ebook-reader-rag.mjs`。
4. 若第 2 步中途失败，集合可能已建但只写入了一部分数据。注意脚本的 `ensureCollection` 只在集合**不存在**时创建，而片段 `id` 是按 `bookId_chapterNum_chunkIndex` 固定生成的，直接重跑**可能**写入主键重复的记录（Milvus 不会自动按主键去重）。想干净重来就先删集合（**会清空该集合全部数据**）：

   ```bash
   node -e "import('@zilliz/milvus2-sdk-node').then(async({MilvusClient})=>{const c=new MilvusClient({address:'localhost:19530'});console.log(await c.dropCollection({collection_name:'ebook_collection'}))})"
   ```

**报 `ERR_MODULE_NOT_FOUND: Cannot find package '@langchain/community'`？**
`node_modules` 与 `package.json` / `pnpm-lock.yaml` 不同步（新增依赖后没重新装）。执行：

```bash
CI=true pnpm install
```

`CI=true` 是为了跳过 pnpm 在非交互终端下清理 `node_modules` 的确认提示。

**`.env` 必须能被读到？**
`import "dotenv/config"` 从**当前工作目录**查找 `.env`，所以请在 `3. milvus-test/` 目录下执行脚本：

```bash
cd "3. milvus-test" && node ./src/ebook-reader-rag.mjs
```

**插入了数据，Attu 里却看不到？**
两点必查：

- **看对集合**：插入目标是 `ai_diary`（脚本里的 `diaryContents` 只是 JS 数组变量名，不是集合名）。
- **维度要一致**：集合 `vector` 字段的 `dim` 必须等于向量 API 实际返回的维度。
  - SDK 参数名是 `dimensions`（复数），会透传给 API 做维度截断；
  - `Qwen/Qwen3-Embedding-8B` 默认输出 **4096 维**，若集合建的是 1024 维，插入会被 Milvus 拒绝，报
    `IllegalArgument: the num_rows (4) of field (vector) is not equal to passed num_rows (1)`
    （4096 维 ÷ 1024 维 = 4，即服务端把一条向量解析成了 4 行），且 SDK 的 `insert_cnt` 返回 `"0"`，脚本误显示成功。
  - 修复：`dimensions` 设为集合维度（如 1024），并在修改集合维度后**删除旧集合重建**（Milvus 建好后不可改维度）。

**插入返回成功但 `getCollectionStatistics` 的 row_count 仍是 0？**
插入默认进入内存中的 growing segment，统计接口可能不反映。调用 `client.flush()` 落盘后再查，或直接以查询结果为准。
脚本末尾已自动 flush。

**重复运行脚本报主键冲突？**
`id` 是主键，重复插入相同 `id` 会被拒绝（或产生重复）。把 `id` 换新（如加时间戳）或先删集合再重跑。

## 安装attu

- 安装 Attu（Milvus 的 Web 管理界面）：
```
docker run -d --name attu -p 3000:3000 -v attu-data:/data zilliz/attu:v3.0.0-beta.6
```

```
连接 milvus 数据库: host.docker.internal:19530
```