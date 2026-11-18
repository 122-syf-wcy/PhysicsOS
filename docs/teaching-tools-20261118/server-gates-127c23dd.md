# 教学完整发布：127c23dd 服务器验收

2026-11-18（UTC）。用户要求优化完成、功能齐全后再上线。只发兼容桥接版的方案已撤下；桥接仍是完整发布验收通过后的安全切换步骤，不是缺功能的交付。

生产未切换：服务器与远端 main 为 `e8151f730acb7944e906811234867517f1d1de97`，应用仍为 `f6e7fb71` 工件，验收 Worker、数据库、反代、回滚镜像与配对恢复点都未动。复核官网 HTTP 200。

[精确冻结构建](/Users/dongsiwei/Desktop/PhysicsOS-UI/docs/teaching-tools-20261118/server-gates-e2d5cf9f.md) 上一阶段的 e2d5cf9f 失败保留。带画布优化的 `127c23dd4323ee0db680e4cc99d8a8db26645f22` 新构建已退出 0，源码摘要 `b95bad2278e961d564fd66d9173656048a75808f596f74dd73e510832fdbcf9d`。保留磁盘水位与 Node compile cache 保护，覆盖全部 159 个编译包及网页产物，71 条成功命令。见[服务器的新版本回执](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-tools-20261118-validation/guarded-build-127c23dd4323-f7o5hep2/result.json)。

实际通过的同版本隔离检查：

- [画布焦点回归](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-canvas-20261118T070713Z-bd2f6e1b9d31649b/result.json)：4/4；完整力学重验 3556.22 ms，密集完整笔迹 3557.36 ms；两个原 5000 ms 门禁通过。删除/恢复代际和磁盘摘要拒绝两项通过。未选择的 65 项不算通过。
- [存储域](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-sdk-20261118T070747Z-a52879e3d228f3dc/result.json)：40/40。[共享工作台](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-workbench-20261118T070803Z-c73818176545039c/result.json)：776/776。[客户端](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-client-20261118T070838Z-ecf9ed1863fc3a3d/result.json)：181/181。
- [隔离 PostgreSQL 耐久性](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-gate-postgres-20261118T071040Z-13865b8dab5b772f/result.json)：5/5；无跳过、未连接正式库。

完整 host 的[正式回执](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-host-20261118T071136Z-bedcc3315746ff98/result.json)为 41 个文件、440 项通过、1 项失败、7 项 opt-in 跳过。失败为跨域运行统计恢复：测试只推进了统计服务时钟，运行来源正确拒绝超过其当前时间的重放窗口。修订测试时将两服务的模拟墙钟同步，不修改产品边界；修订后同回归在隔离源码试验中通过，尚不能替代冻结重跑。独立 5 项 PG 上面已有回执。

统计十倍门禁仍须绑定后续最终冻结源码；保留本版 [CPU 诊断](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-gate-capacity-profile-20261118T072646Z-1a77b18c5b08a5d4/result.json)的 2226.69 ms 失败。在这个冻结构建的只读挂载上，后续改进仅对普通持久行走逐字段严格检查、完整拷贝及共享不变量，特殊形状仍走原 schema。两轮源码诊断十倍均已过原门槛（33121 行、17008630 B）：冷开 1945.64 / 1882.26 ms，20 次无缓存学校榜 p95 738.51 / 687.25 ms；第二轮冷/查询 heap 分别 44087648 B / 1219992 B。见[第一轮](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-gate-capacity-20261118T075526Z-be24abaffab162a5/result.json)、[第二轮](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-gate-capacity-20261118T080105Z-6755ddcd177355de/result.json)、[28 项正确性检查](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-activity-correctness-20261118T080050Z-9f6f0a2a887c827c/result.json)。不把源码试验当成当前已部署或可装载的容量证明。

冷镜像、完整候选与真实浏览器尚未验收；继续串行完成全功能发布，不跳过统计、角色权限、课件或生命周期。
