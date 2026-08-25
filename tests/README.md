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
