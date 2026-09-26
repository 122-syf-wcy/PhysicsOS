# 贡献指南

感谢你愿意参与 PhysicsOS。这是一个面向初高中物理教学的公益项目，欢迎外部开发者、教师与研究者一起维护。

参与本项目即表示你同意遵守 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)，并按 [`LICENSE`](./LICENSE)（Apache License 2.0）的条款提交贡献。

## 开始之前

- Node.js 需要 `>= 24`；大图资源走 Git LFS，clone 前请先安装 `git-lfs`。
- 不要提交任何真实密钥、IP、密码或证书；部署涉及的 7 个 secret 文件见 [`docs/13-DEPLOYMENT-OPERATIONS.md`](./docs/13-DEPLOYMENT-OPERATIONS.md)。
- 动手前先搜索已有 issue 与 PR，避免重复工作；较大的改动请先开 issue 对齐范围。

## 开发环境

仓库根与 `vendor/deepseek-harness` 是两个独立的 pnpm 工作区，pnpm 版本由各自的 `packageManager` 字段固定，不要用全局版本覆盖它：

| 位置                      | pnpm 版本     | 来源                                   |
| ------------------------- | ------------- | -------------------------------------- |
| 仓库根                    | `pnpm@11.9.0` | 根 `package.json` 的 `packageManager`  |
| `vendor/deepseek-harness` | `pnpm@11.7.0` | 上游 submodule 自己的 `packageManager` |

首次克隆：

```sh
git clone <your-fork>
cd PhysicsOS
git submodule update --init --recursive
node scripts/overlay/harness-overlay.mjs apply
pnpm install
```

`vendor/deepseek-harness` 是 pin 住的上游 submodule（上游为 MIT 项目，见 [`NOTICE.md`](./NOTICE.md)），本仓库不修改它的历史。

正式 Web 入口 = 上游 Harness 工作区 + PhysicsOS overlay，因此 `apply` 是必须步骤：

- `overlays/harness/files/**` 会被叠加复制进 `vendor/deepseek-harness/**`；
- `overlays/harness/upstream-changes.patch` 会被打到上游已跟踪文件上。

更细的本地开发说明（含脚本表、单包测试、桌面包重建、Compose 与故障排查）见 [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)。

## 仓库结构与源真值

| 路径                                      | 角色                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `overlays/harness/files/**`               | Harness 侧 PhysicsOS 自有代码的**源真值**，所有 Harness 插件与 UI 改动先改这里                                      |
| `overlays/harness/upstream-changes.patch` | 对上游已跟踪文件的改动；由 `capture` 生成，不要手改                                                                 |
| `packages/**`                             | 领域包源真值（引擎、场景、题库、适配器等），可直接编辑与测试                                                        |
| `apps/desktop/**`                         | 桌面壳与打包脚本源真值                                                                                              |
| `vendor/deepseek-harness/**`              | 上游 submodule + overlay 应用结果；`lib/`、`dist/`、`node_modules/` 是生成物，**不要手改**，会被下一次 `apply` 覆盖 |

正确的工作流是：改 `overlays/harness/files/**` → `node scripts/overlay/harness-overlay.mjs apply` → 在 `vendor/deepseek-harness` 里构建与测试。只有在确实需要改动上游已跟踪文件时，才在 vendor 内修改后由维护者执行 `capture` 回写补丁。

## 分支与提交规范

- 分支命名使用 `codex/` 前缀，例如 `codex/wave-doppler-model`、`codex/fix-class-csrf`。
- 提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
feat(engine-wave): add doppler frequency model
fix(auth-host): reject non-admin settings namespaces
docs: clarify deployment secret rotation
chore(deps): bump vitest to 4.1.10
```

- 一个 PR 尽量聚焦一件事；避免把无关重构、格式化与功能改动混在同一提交里。
- 不要提交构建产物（`lib/`、`dist/`、`*.tsbuildinfo`）或本地临时文件。

## 提交前必须通过的门禁

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

按改动范围追加：

```sh
pnpm run test:desktop      # 改动 apps/desktop/** 或桌面适配器时
pnpm run test:acceptance   # 改动界面、登录、班级、实验等用户流程时
```

只跑单个包或单个 spec 的方式见 [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)。如果某项门禁因环境原因无法运行，请在 PR 里写明具体命令、报错与原因，不要默认跳过。

## Pull Request 流程

1. Fork 仓库并从 `main` 切出 `codex/<short-topic>` 分支。
2. 提交前跑完上面的门禁，`git diff --check` 不应有输出。
3. 按 [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) 填写变更说明、测试证据与截图。
4. 等待 CI 变绿并由维护者评审；评审意见请以代码或注释形式回复，而不是只回复“已改”。
5. 由维护者合并；合并方式（squash / rebase）由维护者决定。

## 评审期望

- 评审关注行为正确性、边界条件、安全默认值与测试覆盖，先于风格问题。
- 涉及 `vendor/deepseek-harness/**` 的改动必须同时给出 overlay 源文件与 `apply` 后的验证结果。
- 涉及物理计算、题目解析或验证器的改动应附带具体数值断言，而不是只断言“能跑”。
- 未完成的能力请如实标注为“规划中”，不要用占位成功状态冒充已实现。

## 许可证相关

- 本仓库自有代码与文档按 Apache License 2.0 授权；提交 PR 即表示你同意你的贡献以同一许可证发布（inbound = outbound），并且你有权提交这些内容。
- 第三方数据与组件有各自的许可证，例如 C-Eval 题库数据为 CC BY-NC-SA 4.0、DeepSeek Harness 为 MIT，详见 [`NOTICE.md`](./NOTICE.md)。新增第三方内容时请在 PR 中说明来源与许可证。
- **许可证变更需要维护者同意**（目前为版权所有者与仓库维护者共同确认），贡献者不能通过普通 PR 单方面更改仓库许可证文本。
