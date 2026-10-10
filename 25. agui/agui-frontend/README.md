# agui 前端（React + Vite）

AG-UI 演示前端：用 `@ai-sdk/react` 的 `useChat` 消费后端流式响应，用 Streamdown 渲染
Markdown、代码高亮（Shiki）与 Mermaid 图表。

配套后端 `../agui-backend`（NestJS，默认 `http://localhost:3000`，接口 `POST /ai/chat`）。
后端地址写在前端 `src/App.tsx` 的 `API_BASE`，请先启动后端再提问。

## 运行

```bash
pnpm install
pnpm start        # 等价于 pnpm dev，启动 Vite 开发服务器
```

其他脚本：`pnpm build`（`tsc -b && vite build`）、`pnpm preview`、`pnpm lint`。

## 依赖与注意事项

- `streamdown` / `@streamdown/code` / `@streamdown/mermaid`：Markdown 渲染及其代码高亮、图表插件。
  三者需一起安装，只装 `@streamdown/*` 插件会导致 Vite 报
  `dependencies are imported but could not be resolved ... Are they installed?`。
- `ThemeInput` 类型请从 `@streamdown/code` 引入：`streamdown` 导出的同名类型把主题名放宽成了
  `string`，而插件用的是 Shiki 的字面量联合类型，两者不兼容会导致 `tsc -b` 报错。
- Streamdown 组件用 Tailwind utility class 渲染，样式依赖宿主项目接入 Tailwind，三处缺一不可：
  1. `vite.config.ts` 注册 `@tailwindcss/vite`；
  2. `src/index.css` 用 `@source` 指向 `streamdown` 与各插件的 `dist/*.js`
     （`node_modules` 不在 Tailwind 默认扫描范围内，不加则表格/代码块的工具类不会生成）；
  3. `@theme` 把 shadcn 语义色（`--color-background`、`--color-muted-foreground`、
     `--color-border`、`--color-primary` 等）映射到本项目配色，否则 `bg-background`、
     `text-muted-foreground` 这些类不会存在。
- 本项目没有 `.dark` 类切换，暗色跟随系统，因此 `src/index.css` 用
  `@variant dark (@media (prefers-color-scheme: dark));` 覆盖 Tailwind 默认的类切换行为，
  否则 Shiki 双主题输出的 `dark:bg-[var(--shiki-dark-bg)]` 不会生效。

---

## 以下是 Vite 模板自带的说明

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
