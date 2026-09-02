# tests

跨 package 的浏览器验收测试。

## acceptance/

对**运行中的 harness web 服务**（`pnpm dev`，端口 3080）做端到端验收走查，
每个里程碑一份 `*-acceptance.mjs`，直接用 node 运行：

```bash
pnpm dev                                        # 先起服务
node tests/acceptance/library-home-acceptance.mjs
```

公共设施在 `support.mjs`：浏览器启动、五项门禁（console / page error /
unhandled rejection / failed request / 4xx-5xx）、✓/✗ 检查台账、
`docs/reports/screenshots/` 截图与 onboarding 跳过。套件只写产品用例。

`harness-*-shot.mjs` 与 `final-screenshots.mjs` 是独立的截图工具，
不参与门禁判定。

## agent/

Harness 模型 → PhysicsOS 工具 → 引擎链路的验收，不需要浏览器，也不需要模型 API Key：

```bash
node tests/agent/headless-physics-acceptance.mjs
```

脚本会启动 Harness 自带的 mock LLM（脚本化成「先请求 `physics_solve_question`，再给出文字答复」），
在临时 `DSH_HOME` 里以 `--profile headless --patch tests/agent/physics-headless.patch.yml`
跑一个真实的 `dsh` 进程，然后解码会话日志断言 13 项门禁：工具目录只含七个 `physics_*` 工具、
persona 含物理宪法、恰好一次 `tool/call`、`tool/result` 为题目运行时的 `solved` 结果且引擎校验
`passed`（R = 7.83 cm、T = 1.64×10⁻⁷ s）、`turn/end` 为 `completed`。

- `physics-headless.patch.yml`：把 headless 档的编码 Agent 换成「物理学习模式」组合的 `--patch` 覆盖层，
  与 Web 预设 `apps/cli/config/agent-presets/physics-student` 同一组合。用真实模型跑一次：
  `pnpm -C vendor/deepseek-harness dsh --profile headless --patch ../../tests/agent/physics-headless.patch.yml "<题面>"`。
- `run-mock-llm.mjs`：单独起 mock LLM（供手工对着 `dsh web` / headless 调试）。
- `dump-session-log.mjs`：把 `session.jsonl.zstd` 逐帧解码打印成 `type :: data`。
