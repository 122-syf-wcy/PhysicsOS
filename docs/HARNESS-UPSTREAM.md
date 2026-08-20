# DeepSeek Harness Upstream Pin

> PhysicsOS 将 DeepSeek Harness 视为 **upstream infrastructure**。  
> 正式产品 UI 是 Harness Web Client + `@deepseek-ai/dsh-client-ui-physicsos`。
> 根目录 `apps/web` 是 A 类旧版/过渡 Physics Workspace，仅保留为迁移参考与历史截图资产，不再发展为第二套 Runtime Host。

## Repository

- URL: `https://github.com/deepseek-ai/deepseek-harness.git`
- Local path: `vendor/deepseek-harness`
- Integration: Git submodule

## Pinned commit

- SHA: `47f943859bef60e4160492346772ded9b24f765a`
- Upstream branch: `master` (`origin/HEAD -> origin/master`)
- Remote: `origin` → `https://github.com/deepseek-ai/deepseek-harness.git`
- Checkout date: `2026-08-16`
- Upstream message: `Merge pull request #2519 from deepseek-harness/feat/npm-public` (`2026-08-13`)
- Upstream version field: `0.1.0-rc.5`

主仓库记录的 submodule commit 即正式版本锁。

## Upstream requirements (from checkout, not guessed)

- `packageManager`: `pnpm@11.7.0`
- Node engines: `^22.19.0 || >=24.0.0`
- TypeScript in Harness: `^6.0.3`（workspace 限制 `typescript: '>=5 <7'`）
- Official source run:

```sh
pnpm install
pnpm run build
pnpm dsh web
```

- Official Web URL: `http://127.0.0.1:3080`

## 初始 PHASE-01 upstream verification（历史基线）

| Step              | Result       | Notes                                                                                                                                                                                                                  |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`    | 依赖安装成功 | 默认 `postinstall` 的 lefthook 在 **git submodule** 下失败：`cannot enable extensions.worktreeConfig while core.worktree is in the common config`。未改 upstream 源码。改用 `pnpm install --ignore-scripts` 完成安装。 |
| `pnpm run build`  | 成功         | Host tsc + tsdown + Client + Web frontend。exit 0。                                                                                                                                                                    |
| `pnpm dsh web`    | 成功启动     | 实际地址：`http://127.0.0.1:3080`。未配置真实 API Key。                                                                                                                                                                |
| Local source diff | 当时无       | 此项只记录初始 pin 验证；当前仓库已通过正式 Client Plugin 接入 Physics Runtime。                                                                                                                                       |

本机验证环境：

- Node: `v24.18.0`（满足 `>=24.0.0`）
- PhysicsOS 根 pnpm: `11.9.0`
- Harness 目录实际使用：`pnpm v11.7.0`（其 `packageManager` 字段）

## PhysicsOS integration boundary

```text
Harness Web Client（产品 Shell）
        ↓
@deepseek-ai/dsh-client-ui-physicsos   （Client Plugin，只占 slot）
        ↓
physics-runtime-bridge                 （Scene → Engine → Verifier → Observation → ViewModel）
        ↓
根仓库 PhysicsOS packages              （repository-relative file: dependencies）

Harness Agent 链路：

@deepseek-ai/dsh-client-ui-physicsos
        ↓
@physicsos/agent-runtime               （稳定 Contract，禁止 import Harness internal）
        ↓
@physicsos/agent-dsh-adapter           （唯一允许理解 Harness API）
        ↓
vendor/deepseek-harness                （pin；Agent Loop / Session / Tools 不改）
```

产品 UI 叠加说明见 `docs/HARNESS-UI-OVERLAY.md`。

禁止：

- 把 Physics Engine / Question Parser 写进 Harness core
- 魔改 Harness Agent Loop / Session Store / Tools
- 在 `@physicsos/web` 或其他业务 package 直接 import Harness internal package
- 用第二层全局顶栏替换 Harness Sidebar / Workspace UX
- 在 `PhysicsCanvas`、Inspector 或其他 UI 组件中零散 import PhysicsOS domain package

## Upgrade procedure

1. 开独立分支
2. 阅读 upstream changelog / `docs/architecture.md`
3. `git -C vendor/deepseek-harness fetch && git -C vendor/deepseek-harness checkout <new-sha>`
4. 在 vendor 目录按官方命令重跑 `pnpm install`（submodule 下如 lefthook 再失败，仍用 `--ignore-scripts`，不要改 upstream）
5. `pnpm run build` 与 `pnpm dsh web` smoke
6. 只改 `@physicsos/agent-dsh-adapter` 与本文件
7. 跑 adapter contract tests + Agent 相关回归（后续阶段）
8. 更新本文件的 SHA / 日期 / 验证状态
9. 提交主仓库 submodule pointer
