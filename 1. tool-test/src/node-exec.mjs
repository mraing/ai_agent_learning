/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-15 20:47:18
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-15 20:48:49
 * @FilePath: /ai agent learning/1. tool-test/src/node-exec.mjs
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */

// ============================================================
// node-exec.mjs —— 用 Node 执行系统命令的示例
//
// 功能：通过 child_process.spawn 启动子进程执行 `ls -la`，
//       命令输出实时打印到控制台，并根据退出码决定当前进程的退出状态。
// 运行：node src/node-exec.mjs
//
// 背景：这是"给模型一个执行命令的工具"的最底层实现，
//       完整版（带 Promise 封装）见 all-tools.mjs 的 executeCommandTool。
// ============================================================

// spawn：child_process 模块提供的"启动子进程"函数。
// 与 exec 不同，spawn 不预先缓冲全部输出，而是以"流"的方式实时输出，
// 适合执行 ls、pnpm、git 这类可能长时间运行、输出很多的命令。
import { spawn } from 'node:child_process';

// 要执行的命令（本示例写死；实际工具中由模型传入）
const command = 'ls -la';

// 子进程的工作目录：默认取当前进程的目录（即运行 node 命令时所在的目录）
const cwd = process.cwd();

// 把命令字符串按空格拆成 [命令本体, 参数1, 参数2, ...]
// 例："ls -la" -> cmd = "ls"，args = ["-la"]
const [cmd, ...args] = command.split(' ');

// 启动子进程。注意：spawn 是异步的、事件驱动的，不会阻塞后续代码
const child = spawn(cmd, args, {
  // 在指定目录下执行命令
  cwd,
  // 子进程的 stdin/stdout/stderr 直接"继承"终端：
  // 命令的实时输出会直接打在控制台上，不需要手动接收
  stdio: 'inherit',
  // 通过系统 shell（/bin/sh）间接执行，
  // 支持管道 |、重定向 >、通配符 * 等 shell 语法
  shell: true,
});

// 保存"进程启动失败"的错误信息，等 close 事件里统一处理
let errorMsg = '';

// error 事件：仅在进程根本启动不起来时触发（命令不存在、权限不足等）
child.on('error', (error) => {
  errorMsg = error.message;
});

// close 事件：子进程结束退出时触发，code 为退出码（0 = 成功，非 0 = 失败）
child.on('close', (code) => {
  if (code === 0) {
    // 命令执行成功：以 0 退出当前 Node 进程，
    // 让调用方（终端 / Agent）根据退出码判断"命令搞定了"
    process.exit(0);
  } else {
    // 命令执行失败：先打印之前捕获的启动错误（如果有）
    if (errorMsg) {
      console.error(`错误: ${errorMsg}`);
    }
    // 以失败码退出当前进程；code 为 null（进程被信号杀死）时兜底用 1
    process.exit(code || 1);
  }
});