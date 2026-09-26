# 维护者指南

维护者负责把 PhysicsOS 保持在可构建、可测试、可发布和可安全运营的状态。权限意味着责任，不等于可以绕过门禁或直接改生产数据。

## 维护者职责

- 及时处理 issue、安全报告和回归问题，说明复现条件与下一步。
- 评审行为、边界条件和安全默认值，优先于纯风格意见。
- 维护 `main` 的可发布性，确保 CI 证据与候选 commit 对应。
- 维护许可证、第三方数据、依赖和 secret 管理边界。
- 在公测或生产事故中记录时间、影响范围、处置和后续修复。

## 评审门槛

每次合并前必须看到同一 commit 的 CI 证据，至少覆盖：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

按改动范围追加对应验证：

```sh
pnpm run test:desktop
pnpm run test:acceptance
docker compose config --quiet
```

涉及 `overlays/harness/files/**` 的改动，必须同时说明 overlay 源文件、`apply` 结果和对应测试；涉及物理计算、题目解析或验证器的改动，必须有具体数值断言，不能只断言“可以运行”。无法在本地执行的验证要在 PR 中写明命令、失败原因和剩余风险。

## 合并策略

- 使用 squash merge，保持 `main` 的历史可读。
- PR 标题和最终提交标题遵循 Conventional Commits，例如 `fix(auth-host): reject invalid reset tokens`。
- 一个 PR 聚焦一个可回滚的行为变化；不要夹带无关重构。
- 需要破坏性变更时，先写清楚迁移、回滚和数据兼容策略。

## 许可证与第三方内容

- 仓库自有代码按 Apache-2.0 授权。许可证变更必须单独提出 PR，说明拟议许可证、变更原因、兼容性风险和生效范围，不能夹带在功能或依赖升级中。
- 许可证变更至少需要 copyright owner 与一名未提交该变更的维护者明确批准；批准记录必须留在 PR 中。
- 合并前必须一致核对根 `LICENSE`、`NOTICE.md`、包元数据和第三方条款，并保留上游版权与 required notice。
- C-Eval 题库等第三方内容保留各自许可证，不能因为仓库改为 Apache-2.0 就默认获得商业使用授权。
- 新增依赖、数据集或生成资产时，在 PR 中记录来源、许可证和使用边界。

## Secret 管理红线

- 任何真实密钥、密码、证书、IP 白名单或生产配置都不得进入 Git、日志、截图、Issue 或 PR。
- 生产使用 Compose secret 文件；本地 `.env*` 必须保持 gitignored，轮换后同步更新部署记录。
- 发布签名私钥只存在于发布 secret manager 或维护者本地受保护目录。
- 发现泄露时先吊销或轮换，再清理历史；只删除工作区文件不算修复。

## 增加新的 overlay 路径

1. 在 `overlays/harness/files/<relative-path>` 放入源真值，不要直接编辑 `vendor/deepseek-harness` 作为最终来源。
2. 在 `scripts/overlay/harness-overlay.mjs` 的 `OVERLAY_PATHS` 中加入该相对路径。
3. 如果新包需要参与根脚本、bundle 依赖或 Harness 配置，同时更新对应引用并补充测试。
4. 运行 `make overlay-apply`，在 vendor 树中执行对应 typecheck、lint、test 和 build。
5. 如修改了 vendor 中已被上游跟踪的文件，由维护者运行 `make overlay-capture` 回收补丁，并检查 `git diff` 没有把生成物带进来。
6. 合并前确认 overlay 与 vendor 的源文件一致，且没有 `.rej`、`.orig` 或未回写的临时状态。
