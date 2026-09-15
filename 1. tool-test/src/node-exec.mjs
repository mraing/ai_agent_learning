/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-15 20:47:18
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-15 20:48:49
 * @FilePath: /ai agent learning/1. tool-test/src/node-exec.mjs
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { spawn } from 'node:child_process';

const command = 'ls -la';
const cwd = process.cwd();

// 解析命令和参数
const [cmd, ...args] = command.split(' ');

const child = spawn(cmd, args, {
  cwd,
  stdio: 'inherit', // 实时输出到控制台
  shell: true,
});

let errorMsg = '';

child.on('error', (error) => {
  errorMsg = error.message;
});

child.on('close', (code) => {
  if (code === 0) {
    process.exit(0);
  } else {
    if (errorMsg) {
      console.error(`错误: ${errorMsg}`);
    }
    process.exit(code || 1);
  }
});