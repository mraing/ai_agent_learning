// 加载 .env 文件中的环境变量（例如 API Key 等）
import "dotenv/config";

// 从 @langchain/langgraph 引入所需 API：
// - Annotation：用于定义图的状态结构（State Schema）
// - END / START：LangGraph 内置的虚拟起点和终点节点
// - StateGraph：用于构建状态图（StateGraph）的类
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// 定义图的状态,Annotation.Root 声明一个状态对象的结构
const StateAnnotation = Annotation.Root({
  text: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

const step1 = (state) => ({ text: `${state.text} -> step1` });
const step2 = (state) => ({ text: `${state.text} -> step2` });

// 构建并编译状态图
const graph = new StateGraph(StateAnnotation)
  // 添加节点
  .addNode("step1", step1)
  .addNode("step2", step2)
  // 定义执行顺序
  .addEdge(START, "step1")
  .addEdge("step1", "step2")
  .addEdge("step2", END)
  // 编译图
  .compile();

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyles: true });
console.log(mermaid);

const result = await graph.invoke({ text: "hello" });
console.log("result:", result);
