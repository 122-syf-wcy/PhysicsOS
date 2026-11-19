# 匀强磁场试题可视化：续开发验收（2026-11-19）

本轮在 `codex/visualization-channels-material-library-20261118` 的 `c11d3dda` 基线上续做，尚未冻结或发布新 revision。未改安卓检出、正式数据库、Compose、运行镜像或回滚快照。上一轮的切换故障见 [c11d3dda 发布记录](visualization-c11d3dda-release-gates.md#用户要求先看现状预览切换与回滚)。

## 这次收口的行为

- 聊天卡片和预览使用同一账号／场景修订／任务绑定。超时、中断、取消和被替换不再持续显示「生成中」；画布握手、私有候选和隔离验收仍然分别显示。恢复提交失败不覆盖原任务结果，旧请求不能覆盖新请求的提示。
- 重新生成接口只有当前请求的持久任务取得租约、并成功追加对应 marker 后才返回 202。已有运行中的自定义任务直接复用；已冻结而未关联的候选优先恢复原产物，不重新调用模型。原题已验证的求解结果不因可视化入队失败而丢失。
- 磁场验收从 canonical scene 独立采样四个四分之一周期位置，并在把初速度 `v0` 提高 10% 后采样新修订。要求同一个 Canvas 上用稳定坐标变换实绘粒子；不接受静止画面、错误方向、旧改参帧或每帧重建 Canvas。模型绘制约束已明确稳定画布和移动端等比例展示。

## 服务器隔离验证

所有结果均来自服务器 Docker，未开放候选端口、未用正式数据或模型凭据。

| 验证 | 结果 | 私有证据路径（以下相对于本轮目录） |
| --- | --- | --- |
| 应用重点回归 | 服务端 543 项、客户端 77 项通过。最后调整运行中任务复用后，相关 134 项单独复跑通过；计数有重叠。 | `app-tests/gate-app05.log`, `app-tests/gate-routes06.log` |
| 上轮真实作者输出重放 | 两份此前分别报 `IMAGE_BINDING_INVALID` 和 `analysis_limit` 的输出都通过当前源码检查；未新增模型调用。首次探针 15 秒超时，单独复跑通过，耗时约 19.8 秒与 10.9 秒。 | `app-tests/gate-replay01.log` |
| 验收 Worker | 139 项重点回归通过（12 项磁场、10 项光学真实 Chromium）；Worker 严格源码检查、3 项组装检查、编译后的力学／光学／磁场适配器导入均通过。 | `worker-regression-02.log`, `worker-gate.log`, `worker-build.log` |
| 原题整链路 | `03-field-out-of-page` 经真实求解器、产物冻结、票据路由、编译后的 Worker 和沙箱 Chromium；测试渲染器 9/9 检查通过并持久化为 `ready`。静止负例持久化为 `failed`，未通过运动和改参。 | `golden-05/gate.log`, `golden-05/evidence/magnetic-golden.json` 与 `.png` |
| 应用 TypeScript | 共享声明、实验 Host、客户端检查及工具包现有编译配置通过。工具包现有配置启用 `noCheck`；强制检查仍有 3 条基线错误，未新增（同条件比较，基线有 4 条）。 | `typecheck-3Gq4JA81/gate.log`, `strict-tool-baseline-dHlNrm8o/gate.log`, `strict-tool-final-8EBpUhV9/gate.log` |

本轮目录：[服务器私有验证证据](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/magnetic-resume-20261119-bU2r9kAO)。整链路截图是人工编写的最小测试渲染器，不是模型输出，也不代表正式站页面已经更新。原题四个采样时间约为 0、40.99、81.98、122.96 ns；改参对照点在相同 40.99 ns 的新修订，径向位置确实变化。

## 发布前仍需完成

1. 释放或扩充服务器空间。根分区只剩约 600 MB；上次应用数据快照仅解包已约 969 MiB。保留现有镜像和配对回滚点，不在容量不足时强构建或切换。
2. 在隔离候选重新运行真实模型生成并完成验收。不能把旧输出静态重放或测试渲染器的通过当作新的真实模型验收。
3. 用 PostgreSQL、应用数据和 Redis 的同点快照按正式 Compose 启动次序重放，查清上次登录和 `/readyz` 通过但 `/physicsos/learning/capabilities` 返回 404 的原因，同时验证活动能力路由。不能用固定 sleep 或首页 200 替代严格验收。

本轮整链路使用了临时隔离 runner。可用 `/run-skill-generator` 把候选 Worker、只读依赖挂载和原题重放步骤固化为项目运行指南。
