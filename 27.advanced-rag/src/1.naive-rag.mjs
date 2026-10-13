/**
 * 1.naive-rag.mjs —— 最基础的 RAG（Retrieval-Augmented Generation，检索增强生成）
 *
 * 整体流程（一张只有直线的 LangGraph 图）：
 *
 *   START ──▶ retrieve（去 Milvus 向量库检索相关片段）──▶ generate（把片段拼进提示词，流式生成回答）──▶ END
 *
 * 运行前置条件：
 *   1. 本机已启动 Milvus（localhost:19530），且集合 ebook_collection 已灌好《天龙八部》分片数据；
 *   2. 同级 .env 中配置了 OPENAI_BASE_URL / OPENAI_API_KEY（走 DashScope 的 OpenAI 兼容接口）。
 * 运行方式：node src/1.naive-rag.mjs
 */

import "dotenv/config"; // 把 .env 读进 process.env（放在最前面，后续模块才能读到）
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Milvus } from "@langchain/community/vectorstores/milvus";

const COLLECTION_NAME = "ebook_collection"; // Milvus 里要查询的集合名
const TOP_K = 5; // 默认召回条数：取相似度最高的前 5 条

/**
 * 图的「状态」定义（state schema）。
 *
 * 这里的键名（question / k / documents / generation）**完全是自定义的**，
 * LangGraph 并不认识它们，只是把它们当作节点之间传递数据的通道（channel）。
 *
 * 每个字段都写成「裸 Annotation」，等价于 Annotation()，会落到 LastValue 通道：
 *   - 没有 reducer：任何节点写入该键，都会整体覆盖旧值（last write wins）；
 *   - 没有默认值：某个键若从未被写入，节点里读到的是 undefined（不会报错，但要自己防）。
 *
 * 四个键的用途：
 *   question   用户原始问题，全流程只读
 *   k          本次检索要取多少条
 *   documents  retrieve 节点写入的检索结果数组
 *   generation generate 节点写入的模型回答全文
 */
const GraphState = Annotation.Root({
    question: Annotation,
    k: Annotation,
    documents: Annotation,
    generation: Annotation,
});

// 对话模型（生成回答用）：temperature=0 让输出尽量确定、可复现
const model = new ChatOpenAI({
    temperature: 0,
    model: "qwen-plus",
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL, // 指向 DashScope 的 OpenAI 兼容端点
    },
    apiKey: process.env.OPENAI_API_KEY,
});

// 向量模型：把「问题」和「文档片段」编码到同一个 1024 维空间，才能比较相似度
const embeddings = new OpenAIEmbeddings({
    model: process.env.EMBEDDING_MODEL_NAME,
    dimensions: 1024,
    configuration: {
        baseURL: process.env.EMBEDDING_MODEL_URL,
    },
    apiKey: process.env.EMBEDDING_MODEL_API,
});

// 向量库句柄：在 main() 里初始化；两个节点函数通过闭包引用它
let vectorStore;

/**
 * 到 Milvus 做相似度检索。
 *
 * @param {string} question 查询文本（内部会先用 embeddings 编码成向量）
 * @param {number} k 返回条数，默认 TOP_K
 * @returns {Promise<Array>} 归一化后的片段数组；检索出错时返回空数组（降级，不让整张图中断）
 */
async function retrieveRelevantContent(question, k = TOP_K) {
    try {
        // similaritySearchWithScore 返回 [Document, score] 二元组数组。
        // 本项目集合用 COSINE 度量，score 越大越相似。
        const docsWithScores = await vectorStore.similaritySearchWithScore(question, k);
        // 把 LangChain 的 Document 拍平成普通对象，方便后续打印、合并、拼提示词
        return docsWithScores.map(([doc, score]) => ({
            score,
            content: doc.pageContent, // 正文
            id: doc.metadata?.id ?? "unknown", // 元数据可能缺失，用 ?? 兜底
            book_id: doc.metadata?.book_id ?? "未知",
            chapter_num: doc.metadata?.chapter_num ?? "未知",
            index: doc.metadata?.index ?? "未知",
        }));
    } catch (error) {
        // 检索只是「增强」而非必需：失败就返回空数组，让 generate 阶段如实回答"没找到"
        console.error("检索内容时出错:", error.message);
        return [];
    }
}

/**
 * 节点 1：检索。
 *
 * 节点函数签名固定是 (state) => Partial<state>，返回值会与旧 state 合并
 * （没返回的键保持原值）。
 * 所以这里其实只返回 { documents } 就够了，把 question / k 原样回写属于冗余写法。
 */
const retrieveNode = async (state) => {
    const documents = await retrieveRelevantContent(state.question, state.k);
    return {
        question: state.question,
        k: state.k,
        documents,
    };
};

/**
 * 节点 2：生成。
 *
 * 1) 把检索到的片段拼成带章节号的上下文文本；
 * 2) 把上下文 + 用户问题塞进提示词模板；
 * 3) 调 model.stream() 流式生成：边收边打印（打字机效果），同时把全文累加进 generation；
 * 4) 返回 { generation }（这里顺手把旧字段也回写了，同样属于冗余写法）。
 */
const generateNode = async (state) => {
    // 每个片段标注「第 N 章」，片段之间用分隔线隔开，减少模型把不同片段串起来的概率
    const context = state.documents
        .map(
            (item, i) =>
                `[片段 ${i + 1}]
章节: 第 ${item.chapter_num} 章
内容: ${item.content}`,
        )
        .join("\n\n━━━━━\n\n");


    // 提示词：明确要求「有依据才答，没找到就如实说」，并给出回答风格约束
    const prompt = `你是一个专业的《天龙八部》小说助手。基于小说内容回答问题，用准确、详细的语言。

请根据以下《天龙八部》小说片段内容回答问题：
${context}

用户问题: ${state.question}

回答要求：
1. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答
2. 可以综合多个片段的内容，提供完整的答案
3. 如果片段中没有相关信息，请如实告知用户
4. 回答要准确，符合小说的情节和人物设定
5. 可以引用原文内容来支持你的回答

AI 助手的回答:`;

    process.stdout.write("\n【AI 回答（流式）】\n");
    let generation = ""; // 流式返回的是碎片，需要自己拼接成完整回答
    const stream = await model.stream(prompt); // 返回异步迭代器，逐块产出内容
    for await (const chunk of stream) {
        // chunk.content 可能是字符串，也可能是结构化的内容数组（多模态），这里只处理纯文本
        const text = typeof chunk.content === "string" ? chunk.content : "";
        if (!text) continue;
        generation += text; // 累积完整回答
        process.stdout.write(text); // 立即输出，形成打字机效果
    }
    process.stdout.write("\n");

    return {
        question: state.question,
        k: state.k,
        documents: state.documents,
        generation, // 简写属性，等价于 generation: generation
    };
};

// ── 组装图：两个节点 + 三条边，构成一条直线流程 ─────────────────────────────
// addNode(名字, 函数)：节点名 "retrieve"/"generate" 也是自定义的，可任意取
// addEdge(A, B)：A 执行完固定走 B
// START / END 是框架常量，分别代表图的入口和出口
const graph = new StateGraph(GraphState)
    .addNode("retrieve", retrieveNode)
    .addNode("generate", generateNode)
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate")
    .addEdge("generate", END)
    .compile(); // compile() 之后才得到可 invoke 的可执行图

async function main() {
    const question = "段誉遇到的第一个神仙姐姐画像，是谁的弟子？";
    const kArg = 5; // 想改召回条数就改这里（由下面的 k 传入图状态）

    // 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
    // drawMermaid() 只是把图结构画出来，方便肉眼检查连线是否符合预期
    const drawable = await graph.getGraphAsync();
    const mermaid = drawable.drawMermaid({ withStyles: true });
    console.log(mermaid);

    console.log("连接到 Milvus...");
    // fromExistingCollection：连接「已存在」的集合，不会重新建表/灌数据
    vectorStore = await Milvus.fromExistingCollection(embeddings, {
        collectionName: COLLECTION_NAME,
        url: "localhost:19530",
        // 下面三个字段是 Milvus 集合的字段映射，告诉 LangChain 哪列是正文/主键/向量
        textField: "content",
        primaryField: "id",
        vectorField: "vector",
        // 索引与检索参数：COSINE 余弦相似度 + HNSW 近似最近邻索引
        indexCreateOptions: {
            metric_type: "COSINE",
            index_type: "HNSW",
            params: { M: 16, efConstruction: 200 }, // 建索引参数
            search_params: { ef: 64 }, // 搜索参数：ef 越大越准但越慢
        },
    });
    // 显式覆盖检索期参数，确保真正搜索时走 COSINE + ef=64
    vectorStore.indexSearchParams = { metric_type: "COSINE", params: JSON.stringify({ ef: 64 }) };
    console.log("✓ 已连接\n");

    // 集合要先 load 进内存才可检索；重复 load 时 Milvus 会报 "already loaded"，这里容忍该错误
    try {
        await vectorStore.client.loadCollection({ collection_name: COLLECTION_NAME });
        console.log(`✓ 集合 ${COLLECTION_NAME} 已加载\n`);
    } catch (error) {
        if (!error.message.includes("already loaded")) {
            throw error; // 其它错误照常抛出
        }
        console.log(`✓ 集合 ${COLLECTION_NAME} 已处于加载状态\n`);
    }

    console.log("=".repeat(80));
    console.log(`问题: ${question}`);
    console.log("=".repeat(80));

    // invoke 的入参就是「初始 state」，键必须与 GraphState 声明一致。
    // documents / generation 必须给初值：裸 Annotation 没有默认值，
    // 若某个键从未被写入，节点里读到的是 undefined（后续 .length / .map 会抛 TypeError）。
    const result = await graph.invoke({
        question,
        k: Number.isFinite(kArg) ? kArg : TOP_K,
        documents: [],
        generation: "",
    });

    // result 是图跑完后的完整 state（包含所有键），不是只有 generation
    console.log("\n【检索相关内容】");
    if (result.documents.length === 0) {
        // 没检索到内容就提前结束，不再看模型输出
        console.log("未找到相关内容");
        console.log("\n【AI 回答】");
        console.log("抱歉，我没有找到相关的《天龙八部》内容。");
        return;
    } else {
        result.documents.forEach((item, i) => {
            // 打印每条片段的相似度与来源元数据，便于判断回答是否有依据
            console.log(`\n[片段 ${i + 1}] 相似度: ${item.score.toFixed(4)}`);
            console.log(`书籍: ${item.book_id}`);
            console.log(`章节: 第 ${item.chapter_num} 章`);
            console.log(`片段索引: ${item.index}`);
            console.log(
                `内容: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`,
            );
        });
    }

    // generateNode 里已经流式打印过回答，这里只对「模型什么都没返回」做兜底提示
    if (!result.generation) {
        console.log("\n【AI 回答】");
        console.log("模型未返回内容。");
    }
}

main()
