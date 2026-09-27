# ADR-0004：图像生成环境变量改名 PHYSICOS_* → PHYSICSOS_*

- 状态：已接受（本仓库改名已完成；`PHYSICOS_*` 旧名保留一个兼容周期后删除）
- 日期：2026-09-28
- 决策人：PhysicsOS owner（由维护者落地）
- 相关文档 / PR：`.env.example`、`compose.yml`、`Dockerfile`、`docs/13-DEPLOYMENT-OPERATIONS.md`、`packages/image-generation/**`、`overlays/harness/upstream-changes.patch`

## 背景

仓库里图像生成的凭据变量存在两种拼写：单 `S` 的 `PHYSICOS_IMAGE_API_KEY`（最早出现在题图生成与部署 secret 接线里）与双 `S` 的 `PHYSICSOS_IMAGE_API_KEY`（owner 在需求里写下的名字）。同一个 key 有两个名字，会同时带来三类风险：

1. **配置漂移**：`compose.yml`、`Dockerfile`、部署文档与 paper-host 的 `apiKeyEnv` 必须逐字一致，任一处写错就是「key 看起来配了、实际取不到」，而图像生成失败在 paper-host 侧只表现为静默降级，很难被察觉。
2. **审计困难**：secret 扫描与轮换要按名字枚举，两个名字意味着两倍的漏配面。
3. **新代码无据可依**：新增的 `@physicsos/image-generation` 适配器必须挑一个名字，任意选择都会固化其中一种拼写。

不决策的代价是：每新增一个图像消费者就再赌一次拼写，且线上已配置的部署无法安全改名。

## 决定

1. **canonical 采用双 `S`**：`PHYSICSOS_IMAGE_API_KEY`、`PHYSICSOS_IMAGE_API_BASE`、`PHYSICSOS_IMAGE_API_MODEL`。
2. **单 `S` 旧名降级为只读别名，保留一个兼容周期**：`PHYSICOS_IMAGE_API_KEY`（以及对称的 `PHYSICOS_IMAGE_API_BASE` / `PHYSICOS_IMAGE_API_MODEL`）仍可被读取，但一旦命中就打印**一次**弃用警告。警告只打印变量名，绝不打印凭据值本身或其任何片段。
3. **每个读者都迁到 canonical 名**：`.env.example`、`compose.yml`、`Dockerfile`、`docs/13-DEPLOYMENT-OPERATIONS.md`、`packages/image-generation/**`，以及 paper-host 的 `apiKeyEnv`。部署侧同时 materialize 两个名字（`compose.yml` / `Dockerfile` 各写两行），使旧 `apiKeyEnv` 拼写的部署无需同步改动即可继续工作。
4. **明确不做**：不改 paper-host 的取图/出图流水线逻辑，只改它的环境变量名接线；不引入第三个名字；不把 key 写进任何被 git 跟踪的文件。

**删除旧名的触发条件**（满足任一即可，届时新增 ADR 记录）：

- 已确认所有在跑部署的 `.env` / secret 文件都改为双 `S`；或
- 下一个 minor 版本发布时（最迟 2026-12-31）。

删除动作：移除 `packages/image-generation/src/config.ts` 的 legacy 常量与回退分支、`compose.yml` / `Dockerfile` 里的单 `S` 行，并在 `docs/13-DEPLOYMENT-OPERATIONS.md` 去掉别名说明。

## 后果

- 正面：一个 canonical 名字贯穿代码、配置与文档；secret 扫描与轮换只需要枚举一组变量；部署可以零停机改名（两个名字同时 materialize）。
- 正面：弃用警告让「还在用旧名」这件事可观测，而不是靠人记得。
- 负面：一个兼容周期内代码里存在两组常量与一段回退逻辑，`config.ts` 稍微变长；compose / Dockerfile 各多一行。
- 负面：兼容期内必须同时保证两个名字都不断链，任何新增读者仍要按 canonical 写。
- 需要跟进：删除旧名后复跑 `pnpm -C packages/image-generation run scan:secrets` 与 `docker compose config --quiet`；确认线上 `.env` 已改名。

## 替代方案

1. **直接硬切到双 `S`、不留别名。** 被放弃：线上部署的 `.env` 与 secret 文件仍是单 `S`，硬切会让题图生成在所有未同步改名的环境里静默降级，且回滚成本高于保留别名的成本。
2. **继续只保留单 `S`（即维持现状）。** 被放弃：owner 已确认 canonical 为双 `S`，且新增的图像适配器需要一个明确、可写进文档与扫描器的规范名。
3. **用代码做一次性启动迁移（读到旧名后反向写入新名）。** 被放弃：环境变量在进程内互相覆盖会让「哪个名字生效」难以推理，也掩盖了配置未改的事实；只读别名 + 警告已经把可观测性拿到手。
