// ============================================================
// all-tools.mjs —— 工具定义模块（被 mini-cursor.mjs 引用）
//
// 用 LangChain 的 tool() 把 4 个 Node 函数包装成"模型可调用的工具"：
//   1. read_file        读取文件内容
//   2. write_file       写入文件内容（自动创建缺失目录）
//   3. execute_command  执行系统命令（可指定工作目录、实时输出）
//   4. list_directory   列出目录下的所有条目
//
// 工具调用原理（Function Calling）：
//   大模型只会输出文本 / 结构化 JSON，并不会真的执行代码。
//   "工具调用" = 模型按 schema 输出调用意图（tool_calls）→
//                由我们的代码找到对应函数真正执行 → 结果回传模型。
//   所以每个工具需要四样东西：执行函数、名字、描述、参数 schema。
// ============================================================

// tool()：工具工厂函数。用法：tool(执行函数, { name, description, schema })
// 执行函数收到的参数，是模型按 schema 生成、并经 zod 校验后的对象
import { tool } from'@langchain/core/tools';
// Node 文件系统模块（Promise 版，可直接 await）
import fs from'node:fs/promises';
// Node 路径处理模块（取目录名、拼路径等）
import path from'node:path';
// 启动子进程执行系统命令
import { spawn } from'node:child_process';
// zod：运行时数据校验库，schema 会被 LangChain 转换成 OpenAI 格式的函数定义
import { z } from'zod';

// ------------------------------------------------------------
// 工具 1：read_file —— 读取指定路径的文件内容
// ------------------------------------------------------------
const readFileTool = tool(
  // 执行函数：{ filePath } 是经 schema 校验后的参数
  async ({ filePath }) => {
    try {
      // 按 utf-8 读取整个文件（相对路径相对于当前工作目录）
      const content = await fs.readFile(filePath, 'utf-8');
      // 在终端打印调用日志，方便调试时观察"模型调了哪个工具"
      console.log(`  [工具调用] read_file("${filePath}") - 成功读取 ${content.length} 字节`);
      // 返回值 = 工具执行结果，会成为 ToolMessage 回传给模型
      return`文件内容:\n${content}`;
    } catch (error) {
      // 读文件失败也返回字符串（而不是抛异常）：
      // 让模型看到错误信息，自己决定如何补救（比如换一个路径重试）
      console.log(`  [工具调用] read_file("${filePath}") - 错误: ${error.message}`);
      return`读取文件失败: ${error.message}`;
    }
  },
  {
    name: 'read_file', // 工具名：模型在 tool_calls 里用这个名字指定调用谁
    description: '读取指定路径的文件内容', // 描述：模型据此判断"什么时候该用这个工具"
    schema: z.object({
      filePath: z.string().describe('文件路径'), // 参数声明：filePath 必须是字符串
    }),
  }
);

// ------------------------------------------------------------
// 工具 2：write_file —— 向指定路径写入文件内容（自动创建目录）
// ------------------------------------------------------------
const writeFileTool = tool(
  async ({ filePath, content }) => {
    try {
      // 取文件所在目录（如 '/a/b.txt' -> '/a'）
      const dir = path.dirname(filePath);
      // 递归创建目录：{ recursive: true } 表示目录已存在也不会报错
      await fs.mkdir(dir, { recursive: true });
      // 写入文件（utf-8 编码）
      await fs.writeFile(filePath, content, 'utf-8');
      console.log(`  [工具调用] write_file("${filePath}") - 成功写入 ${content.length} 字节`);
      return`文件写入成功: ${filePath}`;
    } catch (error) {
      console.log(`  [工具调用] write_file("${filePath}") - 错误: ${error.message}`);
      return`写入文件失败: ${error.message}`;
    }
  },
  {
    name: 'write_file',
    description: '向指定路径写入文件内容，自动创建目录',
    schema: z.object({
      filePath: z.string().describe('文件路径'),
      content: z.string().describe('要写入的文件内容'),
    }),
  }
);

// ------------------------------------------------------------
// 工具 3：execute_command —— 执行系统命令（带实时输出、支持指定工作目录）
// 注意：这是 4 个工具里最复杂的 —— spawn 是事件驱动的，
//       而工具函数必须返回 Promise，所以这里用 new Promise 把
//       "进程结束（close 事件）"包装成"Promise 完成"。
// ------------------------------------------------------------
const executeCommandTool = tool(
  async ({ command, workingDirectory }) => {
    // 工作目录：模型指定了就用它，否则沿用当前目录
    const cwd = workingDirectory || process.cwd();
    console.log(`  [工具调用] execute_command("${command}")${workingDirectory ? ` - 工作目录: ${workingDirectory}` : ''}`);

    // 返回 Promise：直到子进程退出（close 事件触发）才算工具执行完毕
    return new Promise((resolve, reject) => {
      // 把命令字符串拆成 [命令本体, 参数...]，如 "pnpm install" -> ["pnpm", "install"]
      const [cmd, ...args] = command.split(' ');

      // 启动子进程执行命令
      const child = spawn(cmd, args, {
        cwd, // 在指定目录下执行（这就是模型不需要用 cd 命令的原因）
        stdio: 'inherit', // 命令输出实时打印到终端
        shell: true, // 走系统 shell，支持 &&、|、通配符等语法
      });

      // 记录"启动失败"错误（如命令不存在），close 时统一处理
      let errorMsg = '';

      // error 事件：进程根本没启动起来（命令不存在 / 权限不足）
      child.on('error', (error) => {
        errorMsg = error.message;
      });

      // close 事件：进程结束退出。code 为退出码（0 成功，非 0 失败）
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`  [工具调用] execute_command("${command}") - 执行成功`);
          // 附加给模型的重要提示：下次在这个目录继续干活时，
          // 用 workingDirectory 参数而不是 cd（否则会因目录已切换而找不到路径）
          const cwdInfo = workingDirectory
            ? `\n\n重要提示：命令在目录 "${workingDirectory}" 中执行成功。如果需要在这个项目目录中继续执行命令，请使用 workingDirectory: "${workingDirectory}" 参数，不要使用 cd 命令。`
            : '';
          resolve(`命令执行成功: ${command}${cwdInfo}`);
        } else {
          console.log(`  [工具调用] execute_command("${command}") - 执行失败，退出码: ${code}`);
          // 执行失败也 resolve（不 reject）：把失败原因作为结果交给模型决定下一步
          resolve(`命令执行失败，退出码: ${code}${errorMsg ? '\n错误: ' + errorMsg : ''}`);
        }
      });
    });
  },
  {
    name: 'execute_command',
    description: '执行系统命令，支持指定工作目录，实时显示输出',
    schema: z.object({
      command: z.string().describe('要执行的命令'),
      workingDirectory: z.string().optional().describe('工作目录（推荐指定）'), // optional：模型可以不传
    }),
  }
);

// ------------------------------------------------------------
// 工具 4：list_directory —— 列出目录下的所有文件和文件夹
// ------------------------------------------------------------
const listDirectoryTool = tool(
  async ({ directoryPath }) => {
    try {
      // readdir 返回目录条目名数组（如 ["package.json", "src", ...]）
      const files = await fs.readdir(directoryPath);
      console.log(`  [工具调用] list_directory("${directoryPath}") - 找到 ${files.length} 个项目`);
      // 格式化成带 "- " 前缀的清单文本返回给模型
      return`目录内容:\n${files.map(f => `- ${f}`).join('\n')}`;
    } catch (error) {
      console.log(`  [工具调用] list_directory("${directoryPath}") - 错误: ${error.message}`);
      return`列出目录失败: ${error.message}`;
    }
  },
  {
    name: 'list_directory',
    description: '列出指定目录下的所有文件和文件夹',
    schema: z.object({
      directoryPath: z.string().describe('目录路径'),
    }),
  }
);

// 导出 4 个工具：mini-cursor.mjs 从这里 import，再统一 bindTools 给模型
export { readFileTool, writeFileTool, executeCommandTool, listDirectoryTool };