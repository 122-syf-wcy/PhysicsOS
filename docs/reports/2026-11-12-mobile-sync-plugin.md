# 安卓手机互通：独立 Harness 插件交付说明

日期：2026-11-12。**源码与隔离容器验证记录，生产尚未部署。**

## 交付形态

用户要求手机与网页的数据互通以 Harness 可插拔插件形式交付，而不是改造内核或另建数据库。本交付按此执行：

| 插件 | 包名 | 发布服务 | 是否必需 |
| --- | --- | --- | --- |
| `mobile-host` | `@deepseek-ai/dsh-mobile-host` | `/physicsos/mobile/v1` 路由 | 是 |
| `account-sync-host` | `@deepseek-ai/dsh-account-sync-host` | `physicsosMobilePersonalExports` | 是 |

账号、会话、学习记录、班级、题库、公告仍由原有 `auth-host`、`learning-host`、`class-host`、`paper-host`、`notice-host` 持有。插件不建新存储域，也不复制业务规则；停用插件只关闭手机接入，不删除既有数据。

启用组合（无需注销能力）：

```text
auth-host
learning-host
class-host
notice-host
session-persistence-jsonl
account-sync-host
mobile-host
```

## 已实现

- 移动认证：登录/注册/二次验证/刷新/退出、设备管理、资料与密码修改、密码找回、可信客户端地址；凭据错误统一 `UNAUTHENTICATED`，便于客户端刷新。
- 学习同步：自测记录与场景的读写；变更强制 `Idempotency-Key`；场景请求 12 MiB、场景对 2 MiB、完整检查点 8 MiB；检查点校验历史、来源、编辑与播放状态。
- 班级与资料：真实 `class-host`/`paper-host` 门面，成员、发布与答案策略保持不变；筛选先于分页，游标绑定账号实例。
- 作业题图：原生授权下载并校验大小/PNG 尺寸，使用账号实例绑定的本地资源路径；不放宽 WebView 远程访问规则。
- 通知：平台公告与确认、租户公告；缺少真实推送 provider 时注册明确返回 `503 PUSH_UNAVAILABLE`，不把登记当作送达。
- 导出：必需区段全部齐备才成功，缺失即 503；包含学习记录、场景与检查点、Canvas 元数据与对象、班级、通知、白板、用量、账号资料与会话；不包含任何凭据。

## 安卓侧

- 场景新建/导入/复制时统一全部历史快照的 scene ID；独立处理已删除场景；重放只确认 `appliedRevision`。
- 题图走原生授权下载与本地账号目录，不扩大 WebView 可信范围。
- 实验恢复、同步协议与题图三组聚焦测试通过。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 七个 host 包 `tsc -b` | 0 错误 |
| `mobile-host` + `account-sync-host` 测试 | 24/24 |
| 受影响 host 回归（auth/notice/learning/class/paper + 两个新插件） | 全量套件结果见文末 |
| Android JVM 单测（JDK17、`--offline`、候选来源） | 58/58 |
| Android 源码预检 app / 全范围 | PASS |
| Harness 补丁对固定上游（`477b4f4`） | `git apply --check` 通过 |
| overlay 工具测试 | 6/6 |

## 未完成

1. 真实推送厂商 SDK 与送达验收（当前明确 503）。
2. 旧通知数据缺少不可变 `userId` 的归属迁移；私人导出会要求迁移而不是猜测归属。
3. 生产 Postgres/真实存储重启、真机性能与完整设备端到端。
4. 账号注销的底层扩展（会话删除、附件引用账本、查询索引擦除、工作区清理）已独立保留为后续工作，不在本插件内，也未随本次交付启用。未安装注销扩展时，移动端注销请求返回 503 且不消耗凭据、不改动账号。

## 与线上网页修复的关系

交付分支已合并生产在建版本 `3f583fce`（含学习分页/截止时间/编辑器恢复、波形播放、部署脚本修复），没有回退任何已上线修复。学校合并计划补齐了移动端新增的表（`mobile_grants`、`account_deletions`、`usage_receipts`），否则真实合并会被“未知表”拒绝。
