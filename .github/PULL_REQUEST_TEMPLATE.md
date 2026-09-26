## 变更说明

<!-- 这个 PR 做了什么？为什么这么做？关联的 issue / ADR 请贴链接。 -->

- 关联 issue：
- 变更范围：

## 测试证据

<!-- 贴实际命令与结果；未运行的项请写明原因，不要留空。 -->

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- 额外门禁（按改动范围勾选并贴结果）：
  - [ ] `pnpm run test:desktop`
  - [ ] `pnpm run test:acceptance`
  - [ ] 其他：

## 截图 / 录屏

<!-- 界面或可交互行为有变化时必填；没有界面变化写“不涉及”。 -->

| 改动前 | 改动后 |
| ------ | ------ |
|        |        |

## 清单

- [ ] 改动只做了一件事，没有夹带无关重构或格式化
- [ ] 源真值改在 `overlays/harness/files/**`（或 `packages/**`、`apps/desktop/**`），没有手改 `vendor/deepseek-harness/**` 的生成物
- [ ] 没有提交密钥、`.env*`、证书或私钥
- [ ] 新增的第三方代码 / 数据已在 `NOTICE.md` 或 PR 中说明来源与许可证
- [ ] 未完成的能力如实标注为“规划中”，没有用占位成功状态冒充完成
- [ ] 已阅读并遵守 [`CONTRIBUTING.md`](../CONTRIBUTING.md) 与 [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md)
