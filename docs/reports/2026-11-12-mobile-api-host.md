# 安卓移动接口：`/physicsos/mobile/v1` 服务端实现

日期：2026-11-12。**这是源码与隔离容器验证记录，生产部署尚未执行。**

## 背景

安卓 App 的后端契约是 `/physicsos/mobile/v1/`（见[接口约定](../superpowers/plans/2026-11-10-android-implementation.md)），
但生产服务器上这个前缀只按静态文件处理：实测 `GET` 返回 404、`POST` 返回 nginx 的 405，连登录都一样。
App 因此只能显示「服务暂不可用」。交接检查器报缺的 `mobile-host`、`account-erasure-host` 四个文件即为此缺口。

管理员账号 `PhysicsOS` 本身在线上库有效（`POST /physicsos/auth/login` 返回 200，`role: SUPER_ADMIN`），
缺的是移动 API 这一层。

## 本次实现

### 新增 `packages/physicsos/mobile-host`

一个 `/physicsos/mobile/v1` 前缀，把已有业务域组合成 App 的 `{data}` / `{error}` 封套。
**不新建存储域、不复制业务规则**：设备授权、学习记录、班级作业、已核验题库、平台公告分别调用
`auth-host`、`learning-host`、`class-host`、`paper-host`、`notice-host` 已发布的门面。

覆盖的路由见[包说明](../../overlays/harness/files/packages/physicsos/mobile-host/README.md)，包括：

- `auth/*`：登录、注册、二次验证、刷新、退出、学校检索、设备列表与撤销、资料与密码修改、注销；
- `learning/*`：自测记录与场景的分页读写，变更必须带 `Idempotency-Key`；
- `classes/*`：班级、作业列表、提交回执、作业目标与题图；
- `library/*`：已核验题库、来源、批注；
- `notices/*`：平台公告与确认、租户公告；
- `devices/push`：推送终端注册与撤销；
- `account/export`：按分组分页导出，清单只列出真实可产出的分组。

### 新增 `packages/physicsos/account-erasure-host`

`auth-host` 定义了 `physicsosAccountErasure` 契约却从未装配提供者，注销任务受理后没有执行者。
新包把学习、班级、公告三个域的擦除组合起来，并在数据域未挂载时**拒绝声明可用**——
部分成功会让账号不可达而数据残留，比直接拒绝更糟。

### `auth-host` 的改动

- 新增 `packages/physicsos/auth-host/src/mobile-service.ts`：只导出移动契约需要的
  `loginMobile`、`refreshMobile`、`logoutMobile`、`loginMobileTwoFactor`、设备/资料/密码/注销方法，
  以及学校检索。管理面（学校管理、用户、审计、仪表盘、重置队列）不发布给兄弟插件。
- 新增 `deleteMobileAccount`：校验密码与 `DELETE` 确认、写入受理任务、停用账号、撤销会话/令牌/设备授权、
  作废未完成的重置请求，并记录审计；成功后由 `completeAccountErasure` 标记完成。
- 修复两处既有缺陷：缺少 `revokeUserApiTokens` 实现；`api-token` 凭据分支未处理移动令牌类型
  （移动 access token 无法通过 `/api` 策略）。

### `notice-host` 的改动

- 新增 `physicsos_notice.push_terms` 表：只存推送令牌的 SHA-256，按 `userKey` 隔离读写。
- 新增 `src/mobile.ts`：平台公告/确认/公告列表的学生门面与推送终端注册撤销。

### 其他既有类型错误

`learning-host/src/mobile.ts` 与 `class-host/src/service.ts` 各有一处 `tsc` 报错，本机编译无法通过，
一并修正（前者按 `exactOptionalPropertyTypes` 构造可选字段，后者移除未使用变量）。

## 验证

在**从生产镜像新建的一次性容器**中验证（不触碰运行中的 `physicsos-app-1`）：

| 检查 | 结果 |
| --- | --- |
| `tsc -b`（mobile/erasure/auth/notice/learning/class/paper 七个包） | 通过，0 错误 |
| `mobile-host` 契约测试 | 8/8 |
| `account-erasure-host` 契约测试 | 4/4 |
| `auth-host` 移动与安全测试、`notice-host`、`class-host`（含真实插件链组合） | 71/71 |
| `android:source-check --sources-only` 全范围 | **PASS**（此前因缺这两个包 BLOCKED） |

`mobile-host` 测试覆盖封套、401、依赖未挂载时的 503、幂等键缺失时的 400、业务状态原样透传、
未知路径 404、非学生 403，以及导出清单只列已挂载分组——即「绝不把未知失败变成 2xx」。

容器内的 `packages/*` 缺 `tsconfig.json`（生产镜像不含开发配置），依赖这些包的部分测试无法在容器运行，
属于环境限制而非代码失败；完整测试需在具备开发依赖的环境执行。

## 部署前仍需完成

1. 镜像构建需要开发依赖与磁盘空间：服务器根分区当前仅剩约 450 MB，需先清理再构建
   （`docker system df` 显示可回收约 14 GB 镜像与 6 GB 构建缓存）。
2. `upstream-changes.patch` 已加入 `mobile-host`、`account-erasure-host` 与 `class-host` 的
   插件链、`apps/cli` 依赖、`tsconfig` 引用和锁文件条目；`git apply --check` 在服务器
   `vendor/deepseek-harness` 上通过，但未执行镜像构建。
3. 构建成功并切换到候选镜像后，用管理员账号在模拟器上做端到端验证：
   登录、记录同步、班级作业、资料库、注销；不得以源码编译代替这一步。

### 插件加载顺序

`mobile-host` 与 `account-erasure-host` 都在每次请求时解析依赖服务，不依赖加载顺序；
`auth-host` 先发布 `physicsosMobileAuth`，学习/班级/公告后发布各自门面，任何缺失都返回 503 而非空成功。
`auth-host` 仍持有 `physicsosAccountErasure` 的读取权，需要时可在 `auth-host` 内部把它接入
注销受理流程（当前由 `mobile-host` 在收到 `DELETE auth/account` 后调用）。
