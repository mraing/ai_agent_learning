/**
 * rag-webfallback.mjs —— 带「联网兜底」的 RAG：本地知识库答不了，就去网上搜
 *
 * 要解决的痛点：本地向量库只装了《天龙八部》小说正文，像
 * 「2013 版电视剧里这段出现在哪几集」这种问题本地必然查不到。
 * 于是流程里加一个「信息充分性评估」节点：不够 → 联网搜索 → 再评估一次 → 生成。
 *
 * 图的形状（注意 evaluate_local 被复用两次）：
 *
 *   START ─▶ route_question ─┬─ simple ─▶ direct_answer ─▶ END
 *                            └─ complex ─▶ local_retrieve ─▶ evaluate_local
 *                                                               │
 *                                        enough=true ───────────┴─▶ generate ─▶ END
 *                                                               │
 *                                     enough=false ─▶ web_search ─▶（回到 evaluate_local 二次评估）
 *                                                                        │
 *                                                        有联网结果 ─────┴─▶ generate ─▶ END
 *
 * 运行前置条件：
 *   1. 本机 Milvus（localhost:19530）已启动，集合 ebook_collection 有数据；
 *   2. 同级 .env 中配置了 OPENAI_BASE_URL / OPENAI_API_KEY，以及 BOCHA_API_KEY（博查联网搜索）。
 * 运行方式：node src/rag-webfallback.mjs
 */

import "dotenv/config"; // 读取 .env 到 process.env
import { z } from "zod"; // 定义结构化输出
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Milvus } from "@langchain/community/vectorstores/milvus";

// 对话模型：temperature=0，用于路由、评估、生成
const llm = new ChatOpenAI({
  temperature: 0,
  model: "qwen-plus",
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  apiKey: process.env.OPENAI_API_KEY,
});

// 向量模型：本地检索用
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3",
  dimensions: 1024,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 图状态。裸 Annotation = LastValue 通道（覆盖式写入、无默认值），键名全自定义。
 *   question     用户原始问题
 *   k            本地检索条数
 *   strategy     路由结果 "simple" | "complex"
 *   routeReason  路由理由
 *   retrievedDocs 本地检索到的原始片段数组
 *   localContext  本地片段拼成的上下文字符串
 *   webContext    联网搜索结果拼成的上下文字符串
 *   evaluation    评估结果（JSON 字符串，含 enough / missing / reason / web_query）
 *   generation    最终回答
 */
const GraphState = Annotation.Root({
  question: Annotation,
  k: Annotation,
  strategy: Annotation,
  routeReason: Annotation,
  retrievedDocs: Annotation,
  localContext: Annotation,
  webContext: Annotation,
  evaluation: Annotation,
  generation: Annotation,
});

let vectorStore; // 向量库句柄，main() 初始化

/**
 * 本地向量检索。
 * @returns {Promise<Array>} 归一化片段数组；出错返回 []（降级）
 */
async function retrieveRelevantContent(query, k) {
  try {
    const docsWithScores = await vectorStore.similaritySearchWithScore(query, k);
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

/** 路由结果结构：simple（直接答）/ complex（走本地检索 + 可能联网） */
const RouteSchema = z.object({
  strategy: z.enum(["simple", "complex"]),
  reason: z.string(),
});

/**
 * 节点 1：路由判断。
 * 同时把后续节点要用的字段全部初始化，避免读到 undefined。
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
  return {
    strategy: route.strategy,
    routeReason: route.reason,
    retrievedDocs: [],
    localContext: "",
    webContext: "",
    evaluation: "",
    generation: "",
  };
};

/** 节点：直接回答（simple 分支，不检索、不联网） */
const directAnswerNode = async (state) => {
  console.log("---DIRECT_ANSWER---");
  process.stdout.write("\n【AI 回答（流式）】\n");
  let generation = "";
  const stream = await llm.stream(`你是一个中文问答助手，请直接简洁回答问题。

问题：${state.question}
`);
  for await (const chunk of stream) {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (!text) continue;
    generation += text;
    process.stdout.write(text);
  }
  process.stdout.write("\n");
  return { generation };
};

/**
 * 节点 2：本地检索（complex 分支第一步）。
 * 把检索结果既保存为数组（retrievedDocs），也拼成一段文本（localContext），
 * 后者是给评估节点和生成节点当提示词用的。
 */
const retrieveLocalNode = async (state) => {
  console.log("---LOCAL_RETRIEVE---");
  const retrievedDocs = await retrieveRelevantContent(state.question, state.k);
  console.log(`本地检索命中: ${retrievedDocs.length} 条`);
  const localContext = (retrievedDocs ?? []).map((d) => d.content).join("\n\n");
  return {
    retrievedDocs,
    localContext,
  };
};

/** 评估结果结构：够不够、缺什么、以及（不够时）建议的联网查询句 */
const EvaluateSchema = z.object({
  enough: z.boolean(),
  missing: z.array(z.string()).max(6),
  reason: z.string(),
  web_query: z.string().optional(), // 只在「无联网结果」时才会被提示词要求输出
});

/**
 * 节点 3：信息充分性评估（会被调用两次，复用同一个节点）。
 *
 *   第一次：state.webContext 为空 → 只评估本地上下文，若不够则产出 web_query；
 *   第二次：state.webContext 已有内容 → 带着联网结果再评估一次，防止无限联网。
 * 判断依据就是 hasWeb = webContext 非空。
 * 结果被序列化成 JSON 字符串存进 state.evaluation，供条件边 webSearchNode 解析。
 */
const evaluateNode = async (state) => {
  const hasWeb = Boolean(state.webContext && String(state.webContext).trim());
  console.log(hasWeb ? "---EVALUATE_CONTEXT_WITH_WEB---" : "---EVALUATE_LOCAL_CONTEXT---");
  const evaluator = llm.withStructuredOutput(EvaluateSchema);
  const out = await evaluator.invoke(`你是信息充分性评估器。判断当前上下文是否足以回答用户问题。

用户问题：${state.question}

已检索上下文（来自本地知识库）：
${state.localContext || "（空）"}

${hasWeb ? `联网搜索结果：\n${state.webContext || "（空）"}\n` : ""}

输出字段：
- enough: 是否足够回答（true/false）
- missing: 若不够，列出缺失信息点（最多 6 条）
- reason: 简短原因
${hasWeb ? "" : "- web_query: 若不够，给出一个适合联网搜索的中文查询句（完整句，不用代词；为空也可）"}
`);

  console.log(`${hasWeb ? "二次评估" : "评估"}: enough=${out.enough} (${out.reason})`);
  if (!out.enough && out.missing?.length) {
    out.missing.forEach((m, i) => console.log(`  缺失${i + 1}: ${m}`));
  }
  return {
    // 存成 JSON 字符串：既能放进 state 当普通值，又方便条件边/联网节点再解析出来用
    evaluation: JSON.stringify(out),
  };
};

/**
 * Call Bocha Web Search API
 */
// 调博查（Bocha）联网搜索 API，把返回的网页列表拼成一段带引用的文本。
// 这里用原生 fetch，不依赖 LangChain 的联网工具，便于看清楚请求/响应结构。
async function bochaWebSearch(query, count) {
  const apiKey = process.env.BOCHA_API_KEY;
  if (!apiKey) {
    throw new Error("Bocha Web Search 的 API Key 未配置（环境变量 BOCHA_API_KEY）。");
  }
  const url = "https://api.bochaai.com/v1/web-search";
  const body = {
    query,
    freshness: "noLimit", // 不限时间新鲜度
    summary: true, // 让接口额外返回摘要
    count: count ?? 10, // 返回条数
  };

  // 网络层错误（DNS/超时/断网）单独拦一层，抛出更可读的信息
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`搜索 API 请求失败（网络错误）：${error.message}`);
  }

  // HTTP 层错误（4xx/5xx）
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`搜索 API 请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }

  // 响应体不是合法 JSON
  let json;
  try {
    json = await response.json();
  } catch (error) {
    throw new Error(`搜索结果解析失败：${error.message}`);
  }

  // 业务层错误：接口用 code=200 表示成功
  if (json?.code !== 200 || !json?.data) {
    throw new Error(`搜索 API 返回失败：${json?.msg ?? "未知错误"}`);
  }

  // 真实网页列表在 data.webPages.value 里
  const webpages = json.data.webPages?.value ?? [];
  if (!webpages.length) {
    return "未找到相关结果。";
  }

  // 拼成「引用: n + 标题 + URL + 摘要 + 站点 + 时间」的文本，方便模型在回答里标注来源
  return webpages
    .map(
      (page, idx) => `引用: ${idx + 1}
标题: ${page.name}
URL: ${page.url}
摘要: ${page.summary}
网站名称: ${page.siteName}
网站图标: ${page.siteIcon}
发布时间: ${page.dateLastCrawled}`,
    )
    .join("\n\n");
}

/**
 * 节点 4：联网搜索（本轮 fallback 的核心）。
 * 查询句优先用评估节点给出的 web_query（更贴近缺失信息），
 * 拿不到就退回用原始问题。结果写入 webContext。
 */
const webSearchNode = async (state) => {
  console.log("---WEB_SEARCH---");
  // evaluation 是 JSON 字符串，解析失败/为空时降级成空对象
  const parsed = (() => {
    try {
      return JSON.parse(state.evaluation || "{}");
    } catch {
      return {};
    }
  })();
  const query = (parsed.web_query ?? "").trim() || state.question; // 没给查询句就用原问题
  console.log(`联网查询: ${query}`);
  const webContext = await bochaWebSearch(query, 8);
  console.log(`联网结果长度: ${webContext.length}`);
  return { webContext };
};

/**
 * 节点 5：生成回答。
 * 上下文 = 本地片段 + 联网补充（谁有拼谁，用分隔标题隔开），
 * 提示词强调「不许编造，不够就说不确定」。
 */
const generateNode = async (state) => {
  console.log("---GENERATE---");
  const context = [state.localContext, state.webContext].filter(Boolean).join("\n\n===== 联网补充 =====\n\n");
  process.stdout.write("\n【AI 回答（流式）】\n");
  let generation = "";
  const stream = await llm.stream(`你是一个严谨的中文问答助手。优先依据上下文作答，不要编造。

上下文（本地知识库 + 可选联网补充）：
${context || "（空）"}

用户问题：${state.question}

回答要求：
1. 如果上下文足够，给出清晰、可核对的回答；需要时引用“引用: n / URL”或小说片段来支撑。
2. 如果上下文仍不足以确定关键事实，明确说明“不确定/无法从上下文确认”，并说明缺失点。
3. 不要输出表情符号。

回答：`);
  for await (const chunk of stream) {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (!text) continue;
    generation += text;
    process.stdout.write(text);
  }
  process.stdout.write("\n");
  return { generation };
};

/** 条件边：simple → 直接答；complex → 先走本地检索 */
function afterRoute(state) {
  return state.strategy === "simple" ? "direct_answer" : "local_retrieve";
}

/**
 * 条件边：评估之后怎么走。
 *   已有联网结果 → 直接 generate（二次评估后必须收敛，否则会无限联网）；
 *   否则看评估结论：enough === true → generate，否则 → web_search。
 */
function afterEvaluateLocal(state) {
  if (state.webContext && String(state.webContext).trim()) {
    return "generate";
  }
  const parsed = (() => {
    try {
      return JSON.parse(state.evaluation || "{}");
    } catch {
      return {};
    }
  })();
  return parsed.enough === true ? "generate" : "web_search";
}

// ── 组装图 ────────────────────────────────────────────────────────────────
// 关键两条边：
//   local_retrieve → evaluate_local（评估本地够不够）
//   web_search → evaluate_local（联网完再评估一次，形成一次“回环”）
const graph = new StateGraph(GraphState)
  .addNode("route_question", routeQuestionNode)
  .addNode("direct_answer", directAnswerNode)
  .addNode("local_retrieve", retrieveLocalNode)
  .addNode("evaluate_local", evaluateNode)
  .addNode("web_search", webSearchNode)
  .addNode("generate", generateNode)
  .addEdge(START, "route_question")
  .addConditionalEdges("route_question", afterRoute, {
    direct_answer: "direct_answer",
    local_retrieve: "local_retrieve",
  })
  .addEdge("local_retrieve", "evaluate_local")
  .addConditionalEdges("evaluate_local", afterEvaluateLocal, {
    generate: "generate",
    web_search: "web_search",
  })
  .addEdge("web_search", "evaluate_local") // 回环：联网后再评估一次
  .addEdge("direct_answer", END)
  .addEdge("generate", END)
  .compile();

async function main() {
  // 故意设计成「本地答不了后半段」的问题：
  // 前半段（雁门关主谋及其子结局）在小说里，后半段（2013 版电视剧集数）必须联网
  const question =
    "请回答《天龙八部》小说里“雁门关事件”的主谋是谁，并说明其儿子的最终结局；另外请补充：在《天龙八部》2013 版电视剧中，这段“雁门关事件”主要出现在哪几集？请给出可核对的来源链接。";
  const k = 8;

  // 导出图结构为 Mermaid，方便检查回环边是否符合预期
  const drawable = await graph.getGraphAsync();
  console.log(drawable.drawMermaid({ withStyles: true }));

  console.log("连接到 Milvus...");
  vectorStore = await Milvus.fromExistingCollection(embeddings, {
    collectionName: "ebook_collection",
    url: "localhost:19530",
    textField: "content",
    primaryField: "id",
    vectorField: "vector",
    // COSINE 余弦相似度 + HNSW 近似最近邻
    indexCreateOptions: {
      metric_type: "COSINE",
      index_type: "HNSW",
      params: { M: 16, efConstruction: 200 },
      search_params: { ef: 64 },
    },
  });
  vectorStore.indexSearchParams = { metric_type: "COSINE", params: JSON.stringify({ ef: 64 }) };
  console.log("✓ 已连接\n");

  // 集合先 load 才能检索；重复 load 会报 "already loaded"，可忽略
  try {
    await vectorStore.client.loadCollection({ collection_name: "ebook_collection" });
    console.log("✓ 集合 ebook_collection 已加载\n");
  } catch (error) {
    if (!error.message.includes("already loaded")) throw error;
    console.log("✓ 集合 ebook_collection 已处于加载状态\n");
  }

  console.log("=".repeat(80));
  console.log(`问题: ${question}`);
  console.log("=".repeat(80));

  // 初始 state：所有键都给初值（裸 Annotation 无默认值）
  const result = await graph.invoke({
    question,
    k,
    strategy: "",
    routeReason: "",
    retrievedDocs: [],
    localContext: "",
    webContext: "",
    evaluation: "",
    generation: "",
  });

  // 中间过程（评估、联网）都在节点里打印过了，这里只汇总最终策略与空回答兜底
  console.log(`\n最终策略: ${result.strategy}`);
  if (!result.generation?.trim()) {
    console.log("模型未返回内容。");
  }
}

main()
