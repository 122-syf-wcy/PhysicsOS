# Harness Overlay

`vendor/deepseek-harness` 是 pin 住的上游 submodule，本仓库不修改上游历史。PhysicsOS 需要叠加到 Harness 工作区的内容全部放在这里，由 `scripts/overlay/harness-overlay.mjs` 同步。

## 内容

| 路径 | 说明 |
| --- | --- |
| `files/packages/client/ui-physicsos/` | PhysicsOS 正式 Client Plugin 源码与测试（`lib/`、`node_modules/` 为构建产物，不入库） |
| `files/packages/physicsos/tool-physicsos/` | PhysicsOS 宿主侧工具插件 `@deepseek-ai/dsh-tool-physicsos`：把 `@physicsos/agent-tools` 注册为模型可调用的 `physics_*` 工具（`lib/` 由 `pnpm run build:agent` 生成，不入库） |
| `files/apps/cli/config/agent-presets/physics-student/` | Agent 预设「物理学习模式」：物理宪法 persona + 物理工具 + 提问工具，随附根目录发现，Web 设置页可选 |
| `files/packages/client/ui-settings-models/src/client/protocol.ts` | Harness 侧新增文件，被本地改动引用 |
| `files/apps/web/public/physicsos/` | 网页压缩版首页资产 |
| `upstream-changes.patch` | 对 Harness 已跟踪文件的本地改动（不含 `AGENTS.md` 类文档删除）；含 `apps/cli/package.json` 对工具插件的依赖与 `tsconfig.host.json` 的项目引用 |

## 用法

```sh
git submodule update --init --recursive
node scripts/overlay/harness-overlay.mjs apply
```

`apply` 只做叠加复制，不会删除 `vendor/deepseek-harness` 中已有的 `node_modules/` 与 `lib/`；补丁若已应用会跳过。

在 `vendor/deepseek-harness` 里改完代码后，回写到本目录：

```sh
node scripts/overlay/harness-overlay.mjs capture
```

## 边界

- 上游文件版权与许可证归 DeepSeek（MIT），详见仓库根 `NOTICE.md`。
- `files/**` 是 PhysicsOS 自有代码，按仓库根 `LICENSE` 授权。
- 升级 Harness pin 的流程见 `docs/HARNESS-UPSTREAM.md`；pin 变更后必须重新 `capture` 并确认 patch 仍可应用。
