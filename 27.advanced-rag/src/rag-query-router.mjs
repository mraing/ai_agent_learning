/**
 * rag-query-router.mjs ——「查询路由」型 RAG：先判断问题要不要检索，再决定走哪条分支
 *
 * 图的形状（带一个分叉）：
 *
 *                    ┌── simple ──▶ direct_answer（不检索，模型直接答）──▶ END
 *   START ──▶ route_question
 *                    └── complex ─▶ retrieve（向量检索）──▶ rag_generate（带上下文生成）──▶ END
 *
 * 为什么要路由：不是所有问题都值得花一次向量检索 + 更长的上下文，
 * 比如「《天龙八部》的作者是谁」这类常识问题，直接问模型更快也更省。
 *
 * 运行前置条件：
 *   1. 本机 Milvus（localhost:19530）已启动，且集合 ebook_collection 有数据；
 *   2. 同级 .env 中配置了 OPENAI_BASE_URL / OPENAI_API_KEY。
 * 运行方式：node src/rag-query-router.mjs
 */

import "dotenv/config"; // 读取 .env 到 process.env
import { z } from "zod"; // 用 z 定义「模型必须按这个结构输出」
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Milvus } from "@langchain/community/vectorstores/milvus";

// 对话模型：temperature=0 让路由判断和回答都尽量稳定
const llm = new ChatOpenAI({
  temperature: 0,
  model: "qwen-plus",
  configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
  },
  apiKey: process.env.OPENAI_API_KEY,
});

// 向量模型：问题和文档片段都要编码成 1024 维向量才能算相似度
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3",
  dimensions: 1024,
  configuration: { 
    baseURL: process.env.OPENAI_BASE_URL 
  },
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 图状态（state schema）。键名全部自定义，只是节点间传数据的通道。
 *
 * 裸 Annotation = LastValue 通道：无 reducer（覆盖式写入）、无默认值。
 *   question    用户原始问题（只读）
 *   k           检索条数
 *   strategy    路由结果："simple" | "complex"，决定走哪条分支
 *   routeReason 路由理由（模型给的，便于排查误判）
 *   documents   检索结果（只有 complex 分支才写入）
 *   generation  最终回答
 */
const GraphState = Annotation.Root({
  question: Annotation,
  k: Annotation,
  strategy: Annotation,
  routeReason: Annotation,
  documents: Annotation,
  generation: Annotation,
});

let vectorStore; // 向量库句柄，main() 初始化，节点通过闭包使用

/**
 * 向量检索：把问题丢给 Milvus，取回 top-k 片段。
 * @returns {Promise<Array>} 归一化片段数组；出错时返回 []（降级，不中断整图）
 */
async function retrieveRelevantContent(question, k) {
  try {
    // 返回 [Document, score] 二元组；COSINE 度量下 score 越大越相似
    const docsWithScores = await vectorStore.similaritySearchWithScore(question, k);
    return docsWithScores.map(([doc, score]) => ({
      score,
      content: doc.pageContent,
      id: doc.metadata?.id ?? "unknown",
      book_id: doc.metadata?.book_id ?? "未知",
      chapter_num: doc.metadata?.chapter_num ?? "未知",
      index: doc.metadata?.index ?? "未知",
    }));
  } catch (error) {
    console.error("检索内容时出错:", error.message);
    return [];
  }
}

/**
 * 路由结果的结构约定（zod schema）。
 * strategy 限定为两个枚举值，模型不可能给出第三种；reason 是自由文本。
 * 有了它，模型输出会被解析成 JS 对象 { strategy, reason }，不用自己解析 JSON 字符串。
 */
const RouteSchema = z.object({
  strategy: z.enum(["simple", "complex"]),
  reason: z.string(),
});

/**
 * 节点：路由判断（图的第一个节点）。
 * withStructuredOutput(RouteSchema) 会按 schema 约束模型输出（底层用 function calling / JSON schema），
 * 返回值直接是 { strategy, reason } 对象。
 */
const routeQuestionNode = async (state) => {
  console.log("---ROUTE_QUESTION---");
  const router = llm.withStructuredOutput(RouteSchema);
  const route = await router.invoke(`
你是问答路由器。请判断用户问题是否需要外部检索。

规则：
- simple: 常识问答、简短定义、无需特定小说细节即可回答。
- complex: 需要《天龙八部》具体情节、人物关系、章节事实、原文细节或证据支持。

用户问题：${state.question}
`);

  console.log(`路由策略: ${route.strategy} (${route.reason})`);
  // 把路由结果写回 state；decision 函数（decideNext）随后会读 strategy 决定走哪条边
  return {
    question: state.question,
    k: state.k,
    strategy: route.strategy,
    routeReason: route.reason,
  };
};

/**
 * 节点：检索（complex 分支的第一步）。
 * 直接用原始问题去查向量库；返回 documents，交给后面的 ragGenerateNode 拼上下文。
 */
const retrieveNode = async (state) => {
  console.log("---RETRIEVE---");
  const documents = await retrieveRelevantContent(state.question, state.k);
  if (documents.length === 0) {
    console.log("RETRIEVE结果: 未命中文档");
  } else {
    console.log(`RETRIEVE结果: 命中 ${documents.length} 条`);
    documents.forEach((item, i) => {
      // 打印片段预览，方便肉眼确认检索质量
      const preview =
        item.content.length > 120 ? `${item.content.substring(0, 120)}...` : item.content;
      console.log(
        `[R${i + 1}] score=${Number(item.score).toFixed(4)} chapter=${item.chapter_num} index=${item.index}`,
      );
      console.log(`      ${preview}`);
    });
  }
  return {
    question: state.question,
    k: state.k,
    strategy: state.strategy,
    routeReason: state.routeReason,
    documents,
  };
};

/**
 * 节点：直接回答（simple 分支）。
 * 不检索，只把用户问题交给模型，并用 stream() 流式打印。
 * 注意 documents 被显式写成 []，让最终 state 里这个字段有确定的值。
 */
const directAnswerNode = async (state) => {
  console.log("---DIRECT_ANSWER---");
  process.stdout.write("\n【AI 回答（流式）】\n");
  let generation = "";
  const stream = await llm.stream(`你是一个中文问答助手，请直接简洁回答问题。

问题：${state.question}
`);
  for await (const chunk of stream) {
    // chunk.content 可能是字符串或结构化数组，这里只取纯文本
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (!text) continue;
    generation += text; // 拼接完整回答
    process.stdout.write(text); // 边收边打印
  }
  process.stdout.write("\n");
  return {
    question: state.question,
    k: state.k,
    strategy: state.strategy,
    routeReason: state.routeReason,
    documents: [],
    generation,
  };
};

/**
 * 节点：带上下文生成（complex 分支的最后一步）。
 * 与 directAnswerNode 的唯一区别是：提示词里额外塞进了检索到的片段。
 */
const ragGenerateNode = async (state) => {
  console.log("---RAG_GENERATE---");
  // 把片段拼成带章节号的上下文；片段之间用分隔线隔开
  const context = state.documents
    .map(
      (item, i) =>
        `[片段 ${i + 1}]
章节: 第 ${item.chapter_num} 章
内容: ${item.content}`,
    )
    .join("\n\n━━━━━\n\n");
  process.stdout.write("\n【AI 回答（流式）】\n");
  let generation = "";
  const stream = await llm.stream(`你是一个专业的《天龙八部》小说助手。基于小说内容回答问题，用准确、详细的语言。

请根据以下《天龙八部》小说片段内容回答问题：
${context || "（未检索到相关内容）"}

用户问题: ${state.question}

回答要求：
1. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答
2. 可以综合多个片段的内容，提供完整的答案
3. 如果片段中没有相关信息，请如实告知用户
4. 回答要准确，符合小说的情节和人物设定
5. 可以引用原文内容来支持你的回答

AI 助手的回答:`);
  for await (const chunk of stream) {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (!text) continue;
    generation += text;
    process.stdout.write(text);
  }
  process.stdout.write("\n");

  return {
    question: state.question,
    k: state.k,
    strategy: state.strategy,
    routeReason: state.routeReason,
    documents: state.documents,
    generation,
  };
};

/**
 * 条件边（conditional edge）的「判断函数」。
 *
 * 它接收当前 state，返回一个**字符串 key**；addConditionalEdges 的第三个参数
 * 是一个「key → 目标节点名」的映射表，框架据此决定下一步走哪个节点。
 * 这里：非 simple 一律走 retrieve（当前只有 simple/complex 两种取值）。
 * 注意这跟节点函数不同 —— 它只做判断，不读写 state、也不产生状态更新。
 */
function decideNext(state) {
  return state.strategy === "simple" ? "direct_answer" : "retrieve";
}

// ── 组装图 ────────────────────────────────────────────────────────────────
// START → route_question →（条件分叉）→ direct_answer / retrieve
// retrieve → rag_generate；两条分支最后都到 END
const graph = new StateGraph(GraphState)
  .addNode("route_question", routeQuestionNode)
  .addNode("direct_answer", directAnswerNode)
  .addNode("retrieve", retrieveNode)
  .addNode("rag_generate", ragGenerateNode)
  .addEdge(START, "route_question")
  // addConditionalEdges(源节点, 判断函数, 映射表)
  .addConditionalEdges("route_question", decideNext, {
    direct_answer: "direct_answer",
    retrieve: "retrieve",
  })
  .addEdge("retrieve", "rag_generate")
  .addEdge("direct_answer", END)
  .addEdge("rag_generate", END)
  .compile(); // 编译成功后才能 invoke

async function main() {
  // 这句是「多跳+指代」的问题，路由大概率会判成 complex（先查雁门关主谋 → 再查其子结局）
  const question = "雁门关事件的主谋，他的儿子最终结局是什么？";
  const k = 5;

  // 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
  const drawable = await graph.getGraphAsync();
  const mermaid = drawable.drawMermaid({ withStyles: true });
  console.log(mermaid);

  console.log("连接到 Milvus...");
  // 连接已存在的集合（不重建、不灌数据）
  vectorStore = await Milvus.fromExistingCollection(embeddings, {
    collectionName: "ebook_collection",
    url: "localhost:19530",
    textField: "content",
    primaryField: "id",
    vectorField: "vector",
    // 索引/检索配置：COSINE 余弦相似度 + HNSW 近似最近邻
    indexCreateOptions: {
      metric_type: "COSINE",
      index_type: "HNSW",
      params: { M: 16, efConstruction: 200 },
      search_params: { ef: 64 },
    },
  });
  // 显式覆盖检索期参数，确保搜索时用 COSINE + ef=64
  vectorStore.indexSearchParams = { metric_type: "COSINE", params: JSON.stringify({ ef: 64 }) };
  console.log("✓ 已连接\n");

  // 集合需先 load 才能检索；重复 load 会报 "already loaded"，这类错误可忽略
  try {
    await vectorStore.client.loadCollection({ collection_name: "ebook_collection" });
    console.log("✓ 集合 ebook_collection 已加载\n");
  } catch (error) {
    if (!error.message.includes("already loaded")) {
      throw error;
    }
    console.log("✓ 集合 ebook_collection 已处于加载状态\n");
  }

  console.log("=".repeat(80));
  console.log(`问题: ${question}`);
  console.log("=".repeat(80));

  // 初始 state：每个键都要给初值，否则节点里读到 undefined
  const result = await graph.invoke({
    question,
    k: Number.isFinite(k) ? k : 5,
    strategy: "",
    routeReason: "",
    documents: [],
    generation: "",
  });

  // 只有走了 complex 分支才会写 documents，所以这里按 strategy 判断要不要打印检索结果
  if (result.strategy === "complex") {
    console.log("\n【检索相关内容】");
    if (result.documents.length === 0) {
      console.log("未找到相关内容");
    } else {
      result.documents.forEach((item, i) => {
        console.log(`\n[片段 ${i + 1}] 相似度: ${item.score.toFixed(4)}`);
        console.log(`书籍: ${item.book_id}`);
        console.log(`章节: 第 ${item.chapter_num} 章`);
        console.log(`片段索引: ${item.index}`);
        console.log(
          `内容: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`,
        );
      });
    }
  }

  // result 是跑完后的完整 state：strategy 是最终走向，generation 是模型回答
  console.log(`\n最终策略: ${result.strategy}`);
  if (!result.generation?.trim()) {
    console.log("模型未返回内容。");
  }
}

main()
