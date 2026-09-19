<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Environment variables

`.env` at the project root (loaded by `ConfigModule.forRoot` in `src/app.module.ts`):

```bash
DEEPSEEK_API=sk-xxx                 # DeepSeek API key
BASE_URL=https://api.deepseek.com   # OpenAI-compatible base URL
MODEL_NAME=deepseek-flash           # model id
```

数据库用的是 MySQL 8（TypeORM，配置在 `src/app.module.ts`，`synchronize: true` 启动自动建表）：

```bash
docker run -d --name mysql-docker -p 3306:3306 -e MYSQL_ROOT_PASSWORD=admin mysql:8.0
docker exec mysql-docker mysql -uroot -padmin -e "create database hello default charset utf8mb4;"
```

## 项目结构（AI 部分）

```text
src/
├── ai/
│   ├── ai.module.ts          imports: [ToolModule]；providers: [AiService, JobAgentService, UserService]
│   ├── ai.service.ts         聊天用的 agent loop（含流式），工具登记表在 this.tools
│   ├── job-agent.service.ts  定时任务专用 agent loop（不含 cron_job，避免套娃）
│   ├── user.service.ts       mock 用户数据（内存 Map），被包装成 query_user 工具
│   └── ai.controller.ts      /ai/chat、/ai/chat/stream
├── tool/                     ★ 所有 tool 集中在这里，一个 tool 一个 service
│   ├── llm.service.ts                  → CHAT_MODEL
│   ├── send-mail-tool.service.ts       → SEND_MAIL_TOOL
│   ├── web-search-tool.service.ts      → WEB_SEARCH_TOOL
│   ├── db-users-crud-tool.service.ts   → DB_USERS_CRUD_TOOL
│   ├── time-now-tool.service.ts        → TIME_NOW_TOOL
│   ├── cron-job-tool.service.ts        → CRON_JOB_TOOL
│   └── tool.module.ts        把每个 service 的 .tool 映射成 token 并 exports
├── users/                    TypeORM 实体 + REST CRUD（UsersService 被 db_users_crud 工具复用）
└── job/                      Job 实体 + JobService（定时任务持久化与调度）
```

- 新增 tool 四步：① 在 `src/tool/` 写一个 `XxxToolService`（构造函数里 `tool(fn, { name, description, schema })`）→ ② 在 `tool.module.ts` 加 `{ provide: 'XXX_TOOL', useFactory: (svc) => svc.tool, inject: [XxxToolService] }` 并写进 `exports` → ③ 在需要它的 agent loop 的 `this.tools` 登记表里加一行（`bindTools` 自动同步）→ ④ 不用写 `if` 分派，`runTool()` 按名字统一执行。
- **铁律**：模型提出的每个 `tool_call` 都必须回一条 `ToolMessage`（哪怕工具执行失败）。漏掉任何一个，下一轮请求会被 API 拒绝：`400 An assistant message with 'tool_calls' must be followed by tool messages...`。`runTool()` 里的 try/catch 就是为了保证这一点。
- **token 必须完全一致**：`tool.module.ts` 里 `provide: 'XXX'` 与注入处 `@Inject('XXX')` 是**纯字符串匹配**（不认 `.env` 里的变量名，也不认属性名）。写错一个字就是启动报错 `Nest can't resolve dependencies ... "XXX" at index [n]`。现有 token：`CHAT_MODEL`、`SEND_MAIL_TOOL`、`WEB_SEARCH_TOOL`、`DB_USERS_CRUD_TOOL`、`TIME_NOW_TOOL`、`CRON_JOB_TOOL`。
- **循环依赖**：`AiModule → ToolModule → JobModule → AiModule`（JobService 要 JobAgentService，CronJobToolService 要 JobService），两条边用 `forwardRef` 断开，`AiModule` 需要 `exports: [JobAgentService]`。

## Users CRUD API

基于 TypeORM + MySQL 的用户增删改查接口，数据通过 `ValidationPipe` + `class-validator` 校验。

### 创建用户

```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "email": "alice@example.com"
  }'
```

### 查询所有用户

```bash
curl http://localhost:3000/users
```

### 查询单个用户

```bash
curl http://localhost:3000/users/1
```

### 更新用户

```bash
curl -X PATCH http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Only Name Changed"
  }'
```

### 删除用户

```bash
curl -X DELETE http://localhost:3000/users/1
```

## 定时任务（cron / every / at）

OpenClaw / 豆包同款方案：任务**持久化到数据库**，到点后跑一个**独立的 agent loop** 去执行指令文本。

| 类型 | 语义 | 字段 | 适用说法 |
|---|---|---|---|
| `at` | 到点执行**一次**，执行后自动停用 | `at`（时间点） | “1分钟后提醒我喝水” |
| `every` | 按固定间隔**循环**执行 | `everyMs`（毫秒） | “每1分钟提醒我喝水” |
| `cron` | 按 Cron 表达式循环执行 | `cron`（6 位，最小到秒） | “用 cron 表达式 */5 * * * * *” |

- **存储**：`job` 表（`src/job/entities/job.entity.ts`），`synchronize: true` 自动建表
- **调度**：`@nestjs/schedule` 的 `SchedulerRegistry` + `cron` 包的 `CronJob`、`setInterval`、`setTimeout`
- **重启恢复**：`JobService.onApplicationBootstrap()` 把数据库里 `isEnabled=true` 的任务重新注册（重启不丢任务）
- **执行**：到点后调 `JobAgentService.runJob(instruction)` 跑 agent loop（可用 `send_mail` / `web_search` / `db_users_crud` / `time_now`，**不含 `cron_job`**，避免定时任务里再建定时任务）
- **自然语言管理**：`cron_job` 工具支持 `list` / `add` / `toggle`；`instruction` 只存“要做什么”（去掉“什么时候执行”），时间信息转成 `at`/`everyMs`/`cron`

```bash
# 一次性任务：1 分钟后查一次用户数
curl "http://localhost:3000/ai/chat?query=1分钟后查询 users 表，告诉我当前有多少个用户"

# 周期任务：每 20 秒一次
curl "http://localhost:3000/ai/chat?query=每20秒查询一次 users 表的用户数量"

# 列出 + 停用
curl "http://localhost:3000/ai/chat?query=列出当前所有定时任务，然后停掉 cron 表达式那个"
```

```sql
-- 直接查数据库看任务与执行情况（lastRun）
select id,type,cron,everyMs,at,isEnabled,lastRun,instruction from job;
```

> 注意：周期任务会在后台反复触发（每次都会调一次大模型），测试完记得 `toggle` 停掉。

## Chat endpoints

```bash
curl "http://localhost:3000/ai/chat?query=查询用户001的信息"
# → { "answer": "..." }（模型会自动调用 query_user 工具）

curl -N "http://localhost:3000/ai/chat/stream?query=查询用户001的信息"
# → SSE 逐字推送
```

多工具串联（先查用户，再发邮件）：

```bash
curl "http://localhost:3000/ai/chat?query=查询用户001的信息,发送到邮箱 someone@example.com"
```

用自然语言操作数据库：

```bash
curl "http://localhost:3000/ai/chat?query=往 users 表里创建一个用户，姓名 Bob，邮箱 bob@example.com，然后列出所有用户"
```

邮件相关环境变量（QQ 邮箱为例，`MAIL_PASS` 填授权码而非登录密码）：

```bash
MAIL_HOST=smtp.qq.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=you@qq.com
MAIL_PASS=xxxxxxxxxxxxxxxx
MAIL_FROM="No Reply" <you@qq.com>
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observer](https://observer.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
