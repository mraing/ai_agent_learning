/**
 * rag-multihop.mjs —— 多跳（Multi-hop）RAG：把复杂问题拆成有序子问题，逐条检索后再回答
 *
 * 要解决的痛点：像「四大恶人排行第二的是谁？此人之子在身世揭晓前，其生父的公开身份是什么？」
 * 这种问题，直接拿整句去向量检索往往查不准；正确做法是先查「四大恶人老二」，再据此查「其子」，
 * 一步步把事实补齐（先定实体，再查关系/结论）。
 *
 * 图的形状（注意 plan_next_step → retrieve 形成**循环**）：
 *
 *   START ─▶ route_question ─┬─ simple ─────────────────────────────▶ direct_answer ─▶ END
 *                            └─ complex ─▶ decompose_question ─▶ retrieve ─▶ plan_next_step
 *                                                                  ▲              │
 *                                                                  └── retrieve ──┤（还缺事实且未超上限）
 *                                                                                 └─ generate ─▶ END
 *
 * 运行前置条件：
 *   1. 本机 Milvus（localhost:19530）已启动，集合 ebook_collection 有数据；
 *   2. 同级 .env 中配置了 OPENAI_BASE_URL / OPENAI_API_KEY。
 * 运行方式：node src/rag-multihop.mjs
 */

import "dotenv/config"; // 读取 .env 到 process.env
import { z } from "zod"; // 定义「模型必须按这个结构输出」
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Milvus } from "@langchain/community/vectorstores/milvus";

// 对话模型：temperature=0，用于路由、拆解、规划、生成四类调用
const llm = new ChatOpenAI({
  temperature: 0,
  model: process.env.MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  apiKey: process.env.OPENAI_API_KEY,
});

// 向量模型：把查询和文档编码到同一 1024 维空间
const embeddings = new OpenAIEmbeddings({
  model: process.env.EMBEDDING_MODEL_NAME,
  dimensions: 1024,
  configuration: {
    baseURL: process.env.EMBEDDING_MODEL_URL,
  },
  apiKey: process.env.EMBEDDING_MODEL_API,
});

// 图状态。键名全自定义；裸 Annotation = LastValue 通道（覆盖式写入、无默认值）。
/**
 * complex：先拆解子问题序列，再按序检索
 */
const GraphState = Annotation.Root({
  question: Annotation,
  k: Annotation,
  strategy: Annotation,
  routeReason: Annotation,
  /** 拆解得到的有序子问题，仅用于检索 */
  subQuestions: Annotation,
  /** 下一轮 retrieve 要用的下标（指向 subQuestions 中尚未检索的那一条） */
  nextSubIdx: Annotation,
  documents: Annotation,
  currentQuery: Annotation,
  retrievalCount: Annotation,
  maxRetrievals: Annotation,
  plannedNext: Annotation,
  generation: Annotation,
});

let vectorStore; // 向量库句柄，由 main() 赋值

/**
 * 一次向量检索。
 * @returns {Promise<Array>} 归一化片段数组（含 score / 正文 / 元数据）；出错返回 []
 */
async function retrieveRelevantContent(question, k) {
  try {
    // [Document, score][]; COSINE 度量下 score 越大越相似
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

/** 按 id 合并；同 id 保留更高 score */
// 多轮检索会重复命中同一片段，这里按 id 去重：同 id 只留分数更高的那条，最后按分数降序排列。
// 用 Map 保证 id 唯一，Array.from(map.values()) 拿到去重后的数组。
function mergeUnique(existingDocs, newDocs) {
  const map = new Map();
  for (const d of [...existingDocs, ...newDocs]) {
    const key = String(d.id);
    const prev = map.get(key);
    if (!prev || Number(d.score) > Number(prev.score)) {
      map.set(key, d);
    }
  }
  return Array.from(map.values()).sort((a, b) => Number(b.score) - Number(a.score));
}

// ── 三种「结构化输出」约定（zod schema）────────────────────────────────────
// 有了 schema，模型输出会被约束/解析成 JS 对象，不需要自己解析 JSON 字符串。

/** 路由结果：要不要检索 */
const RouteSchema = z.object({
  strategy: z.enum(["simple", "complex"]),
  reason: z.string(),
});

/** 每轮规划结果：下一步是继续检索还是可以生成回答 */
const NextStepSchema = z.object({
  nextAction: z.enum(["retrieve", "generate"]),
  reason: z.string(),
});

/**
 * 节点 1：路由判断。
 * 决定这个问题走 simple（直接答）还是 complex（拆解 + 多轮检索）。
 * 同时把 complex 分支要用到的计数器/数组全部初始化，避免后续节点读到 undefined。
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
    retrievalCount: 0, // 已检索轮数清零
    maxRetrievals: state.maxRetrievals ?? 8, // 轮数上限（初始没给就用 8）
    documents: [], // 累计召回结果
    subQuestions: [], // 子问题列表（由 decompose 节点填充）
    nextSubIdx: 0, // 下一条待检索子问题的下标
    currentQuery: "", // 本轮实际使用的查询句
  };
};

/** 拆解结果：1~8 条有序子问题 */
const DecomposeSchema = z.object({
  sub_questions: z.array(z.string()).min(1).max(8),
  reason: z.string(),
});

/**
 * 节点 2：拆解子问题（只有 complex 分支会走到）。
 * 关键点：子问题必须**有序**且**可独立检索**（不许出现「他/她/此人」这类指代），
 * 因为后面是「一条子问题 → 一轮向量检索」，检索器看不到上下文。
 */
const decomposeQuestionNode = async (state) => {
  console.log("---DECOMPOSE_QUESTION---");
  const decomposer = llm.withStructuredOutput(DecomposeSchema);
  const out = await decomposer.invoke(`你是《天龙八部》多跳问答的「子问题拆解器」。

用户原始问题：
${state.question}

任务：将问题拆成**有序**子问题列表 sub_questions，用于**依次向量检索**。要求：
1. 链式推理、多层关系、因果先后的问题，必须拆成多条；单跳即可答的也可只输出 1 条。
2. 每条子问题必须是**可独立检索**的完整中文问句，**禁止**使用「他/她/此人/上文」等指代；可写全人物名与事件名。
3. 顺序必须符合推理链：先搞清前置实体/事实，再查后续结论。
4. **不要**把整句原题原样复制成唯一一条（除非确实无法拆分）；不要拆成过碎的关键词列表。
5. 输出 1～8 条即可。

请输出 sub_questions 与简短 reason。`);

  // 去掉首尾空白、过滤空串，防止模型返回 "  " 这类脏数据污染后续检索
  const subQuestions = out.sub_questions.map((s) => s.trim()).filter(Boolean);
  if (subQuestions.length === 0) {
    throw new Error("decompose_question: sub_questions 为空");
  }

  console.log(`拆解 ${subQuestions.length} 条子问题 (${out.reason})`);
  subQuestions.forEach((q, i) => {
    console.log(`  [${i + 1}] ${q}`);
  });

  // 从第 0 条开始检索：nextSubIdx 是「游标」，retrieve 节点每跑一轮 +1
  return {
    subQuestions,
    nextSubIdx: 0,
    currentQuery: subQuestions[0],
  };
};

/**
 * 节点 3：检索（循环体）。
 * 每轮只查 subQuestions[nextSubIdx] 这一条，然后把结果按 id 合并进 documents，
 * 并把游标 nextSubIdx 前进一格。
 */
const retrieveNode = async (state) => {
  const subs = state.subQuestions ?? [];
  const idx = state.nextSubIdx ?? 0;
  const q = subs[idx]?.trim();
  if (!q) {
    // 没有可检索的子问题却走到了 retrieve，说明规划逻辑出问题，直接抛错暴露
    throw new Error(`retrieve: 子问题下标 ${idx} 无有效文本（共 ${subs.length} 条）`);
  }

  const round = state.retrievalCount + 1; // 人类可读的轮次（从 1 开始）
  console.log(`---RETRIEVE (第 ${round} 轮，子问题 ${idx + 1}/${subs.length})---`);
  console.log(`查询: ${q}`);

  const newDocs = await retrieveRelevantContent(q, state.k);
  const merged = mergeUnique(state.documents ?? [], newDocs); // 与历史结果去重合并

  if (newDocs.length === 0) {
    console.log("本轮未命中文档");
  } else {
    console.log(`本轮命中 ${newDocs.length} 条，累计去重后 ${merged.length} 条`);
    newDocs.forEach((item, i) => {
      const preview =
        item.content.length > 120 ? `${item.content.substring(0, 120)}...` : item.content;
      console.log(
        `[R${i + 1}] score=${Number(item.score).toFixed(4)} chapter=${item.chapter_num} index=${item.index}`,
      );
      console.log(`      ${preview}`);
    });
  }

  return {
    documents: merged,
    retrievalCount: round,
    nextSubIdx: idx + 1, // 游标前进，下一轮查下一条子问题
    currentQuery: q,
  };
};

/**
 * 节点 4：规划下一步（循环的「出口判断」）。
 * 让模型看着「子问题序列 + 已召回文档摘要 + 剩余轮数」决定：还查不查。
 * 除了模型判断，这里还有**硬性兜底**（见函数末尾），保证循环一定会终止。
 */
const planNextStepNode = async (state) => {
  console.log("---PLAN_NEXT_STEP---");
  const subs = state.subQuestions ?? [];
  const nextIdx = state.nextSubIdx ?? 0;
  const remaining = subs.length - nextIdx; // 还剩几条子问题没查

  // 把子问题列表渲染成带状态标记的清单，方便模型判断进度：
  // （已检索）/（下一轮将检索，若选择继续）/（未检索）
  const subList = subs.map((s, i) => `${i + 1}. ${s}${i < nextIdx ? " （已检索）" : i === nextIdx ? " （下一轮将检索，若选择继续）" : " （未检索）"}`).join("\n");

  // 已召回文档摘要：只截前 6 条、每条 200 字，避免提示词过长
  const docStr =
    state.documents.length === 0
      ? "（尚无检索结果）"
      : state.documents
          .slice(0, 6)
          .map(
            (d, i) =>
              `[${i + 1}] score=${Number(d.score).toFixed(4)} 第${d.chapter_num}章: ${d.content.slice(0, 200)}${d.content.length > 200 ? "..." : ""}`,
          )
          .join("\n\n");

  // 提示词刻意写明：下一轮查什么由「子问题序列」决定，模型只负责决定要不要继续，
  // 从而避免模型自拟查询句导致检索漂移
  const prompt = `你是多跳 RAG 规划器。检索查询已由前置步骤拆解为**有序子问题**；若需继续检索，下一轮将自动使用「下一条子问题」做向量检索，你**不要**自拟新的检索句。

用户原始问题：${state.question}

子问题序列：
${subList || "（无）"}

已检索轮数：${state.retrievalCount}；剩余未检索子问题条数：${remaining}
最大检索轮数上限：${state.maxRetrievals}

已召回文档摘要：
${docStr}

请判断下一步：
1) 已有足够依据回答用户原始问题 → nextAction=generate
2) 仍缺关键事实、且仍存在未检索的子问题、且未超过轮数上限 → nextAction=retrieve

硬性规则：
- 若剩余未检索子问题条数为 0，必须 nextAction=generate。
- 若已检索轮数已达到或超过最大检索轮数，必须 nextAction=generate。`;

  const model = llm.withStructuredOutput(NextStepSchema);
  const { nextAction, reason } = await model.invoke(prompt);

  // ── 硬性兜底：不完全信任模型的判断，用代码强制两条终止条件 ──
  let finalNext = nextAction;
  if (state.retrievalCount >= state.maxRetrievals) finalNext = "generate"; // 到达轮数上限
  if (remaining <= 0) finalNext = "generate"; // 没有子问题可查了

  console.log(`[决策] plannedNext=${finalNext} (模型建议=${nextAction}) (${reason})`);

  return {
    plannedNext: finalNext,
  };
};

/** 条件边判断函数：simple → 直接答；否则 → 拆解后多轮检索 */
function afterRoute(state) {
  return state.strategy === "simple" ? "direct_answer" : "decompose_question";
}

/** 条件边判断函数：规划结果决定是回 retrieve 继续循环，还是去 generate 收尾 */
function afterPlan(state) {
  return state.plannedNext === "retrieve" ? "retrieve" : "generate";
}

/**
 * 节点：直接回答（simple 分支，不检索）。
 * 用 llm.stream() 流式输出，并累积成 generation。
 */
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
 * 节点：最终生成（complex 分支的收尾）。
 * 把多轮检索到的所有片段拼成上下文，连同原始问题交给模型作答。
 */
const generateNode = async (state) => {
  console.log("---GENERATE---");
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
  return { generation };
};

// ── 组装图 ────────────────────────────────────────────────────────────────
// 与 rag-query-router 相比，多出的三处是：
//   1) decompose_question 节点（拆子问题）；
//   2) plan_next_step 节点（决定是否继续查）；
//   3) plan_next_step → retrieve 这条回边，构成「检索-规划」循环。
const graph = new StateGraph(GraphState)
  .addNode("route_question", routeQuestionNode)
  .addNode("direct_answer", directAnswerNode)
  .addNode("decompose_question", decomposeQuestionNode)
  .addNode("retrieve", retrieveNode)
  .addNode("plan_next_step", planNextStepNode)
  .addNode("generate", generateNode)
  .addEdge(START, "route_question")
  .addConditionalEdges("route_question", afterRoute, {
    direct_answer: "direct_answer",
    decompose_question: "decompose_question",
  })
  .addEdge("decompose_question", "retrieve")
  .addEdge("retrieve", "plan_next_step")
  .addConditionalEdges("plan_next_step", afterPlan, {
    retrieve: "retrieve", // 回边：继续下一轮检索
    generate: "generate",
  })
  .addEdge("direct_answer", END)
  .addEdge("generate", END)
  .compile();

async function main() {
  // 典型的两跳问题：先确定「四大恶人老二」→ 再查「其子」的生父公开身份
  const question =
    "《天龙八部》中「四大恶人」排行第二的是谁？此人之子在身世揭晓前，其生父在武林中的公开身份是什么？";
  const k = 5;

  // 把图导出成 Mermaid 文本，可视化节点与循环边（可贴到 mermaid.live 查看）
  const drawable = await graph.getGraphAsync();
  console.log(drawable.drawMermaid({ withStyles: true }));

  console.log("连接到 Milvus...");
  // 连接已存在的集合
  vectorStore = await Milvus.fromExistingCollection(embeddings, {
    collectionName: "ebook_collection",
    url: "localhost:19530",
    textField: "content",
    primaryField: "id",
    vectorField: "vector",
    // COSINE 余弦相似度 + HNSW 近似最近邻索引
    indexCreateOptions: {
      metric_type: "COSINE",
      index_type: "HNSW",
      params: { M: 16, efConstruction: 200 },
      search_params: { ef: 64 },
    },
  });
  vectorStore.indexSearchParams = { metric_type: "COSINE", params: JSON.stringify({ ef: 64 }) };
  console.log("✓ 已连接\n");

  // 集合先 load 才能查；"already loaded" 属正常情况
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

  // 初始 state：所有键都给初值（裸 Annotation 无默认值）
  const result = await graph.invoke({
    question,
    k: Number.isFinite(k) ? k : 5,
    strategy: "",
    routeReason: "",
    subQuestions: [],
    nextSubIdx: 0,
    documents: [],
    currentQuery: "",
    retrievalCount: 0,
    maxRetrievals: 8, // 最多检索 8 轮，超出后 plan 节点会强制转 generate
    plannedNext: "",
    generation: "",
  });

  // 只有 complex 分支才有子问题与检索结果，按 strategy 决定是否打印
  if (result.strategy === "complex") {
    if (result.subQuestions?.length) {
      console.log("\n【子问题序列】");
      result.subQuestions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    }
    console.log("\n【检索相关内容（累计）】");
    if (result.documents.length === 0) {
      console.log("未找到相关内容");
    } else {
      result.documents.forEach((item, i) => {
        console.log(`\n[片段 ${i + 1}] 相似度: ${Number(item.score).toFixed(4)}`);
        console.log(`书籍: ${item.book_id}`);
        console.log(`章节: 第 ${item.chapter_num} 章`);
        console.log(`片段索引: ${item.index}`);
        console.log(
          `内容: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`,
        );
      });
    }
    console.log(`\n检索轮数: ${result.retrievalCount} / ${result.maxRetrievals}`);
  }

  console.log(`\n最终策略: ${result.strategy}`);
  if (!result.generation?.trim()) {
    console.log("模型未返回内容。");
  }
}

// 顶层入口：给 main() 挂 catch，出错时打印原因并以非 0 退出码结束
main().catch((err) => {
  console.error("运行失败:", err);
  process.exit(1);
});
