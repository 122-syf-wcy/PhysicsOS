# e2d5cf9f 服务器构建、验收与停发记录

日期：2026-11-18（UTC）。本记录不表示教学功能已上线。

- 功能分支冻结提交：`e2d5cf9f4b0ac4da151eab392ba2debbed0b4d90`；源码摘要：`fd2c249de1b4155018b4936c0a94ff61b14653721e6bf7455162f98377eafdb5`。
- 生产检出及 `origin/main` 仍是 `e8151f730acb7944e906811234867517f1d1de97`。线上应用镜像仍是 `sha256:eddf40d1307b644db51edd995c98f731ecec8ee4cb668f7237447bbbba765bdc`，验收 Worker 不变。五个生产容器全部 healthy，公网 HTTP 200。未执行生产切换；原配对恢复点和应用/Worker 回滚镜像保留。

## 构建成功，但没有通过完整发布门禁

精确冻结版本在服务器既有非生产构建器中成功完成。合并 TypeScript 项目调用，并用已实测的重复精确 `--filter` 参数分批运行同样的 tsdown 范围；未改变冻结源码或削减范围。159 个编译包、71 条成功工具调用，包含网页构建；退出 0，耗时 1423.22 秒。构建时 Node 磁盘编译缓存禁用；宿主实时监测磁盘，停机水位 768 MiB，本轮最低约 2.01 GiB，没有触水位。先前逐包构建被精确停止，使用正则 filter 的尝试失败，两条轨迹均保留，不计入通过。

[成功构建回执](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-tools-20261118-validation/guarded-build-e2d5cf9f4b0a-cpb7694v/result.json) · [构建证据](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-tools-20261118-validation/guarded-build-e2d5cf9f4b0a-cpb7694v/build-evidence.json)

| 本次验收 | 实测结果 |
| --- | --- |
| [存储域回归](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-sdk-20261118T054108Z-cc740c2be48d3690/result.json) | 4 文件，40 通过，0 失败或跳过。包含完整导入及 Proxy/getter 快照语义。 |
| [客户端回归](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-client-20261118T055146Z-ace6dd756651040a/result.json) | 20 文件，181 通过，0 失败或跳过。 |
| [隔离 PostgreSQL 耐久性](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-gate-postgres-20261118T055641Z-d496f1c815f1270b/result.json) | 5 文件，5 通过，0 失败或跳过。覆盖课件、画布、个人状态、实验运行、统计。未连接生产数据库。 |
| [画布两项性能回归](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-canvas-20261118T054719Z-a2c096a0442e269f/result.json) | **失败**。独立完整力学重验 6648.29 ms；10000 个原始压力采样（2 条各 5000 点）的画布助手上下文 7886.40 ms。两项均为原 5000 ms 门禁，未减数据、未放宽断言。焦点选择以外的 46 项不计为通过。 |
| [隔离 PostgreSQL 统计容量](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-gate-capacity-20261118T054756Z-b23fc7b66a435f55/result.json) | **1× 通过，10× 失败**。10× 载入完整 33121 行、17008630 B，冷启动 2113.14 ms > 2000 ms；不把未到达的查询 p95 算作通过。保持统计查询门禁关闭。 |

最初的画布测试在收集时因只读构建投影中有 `0600`、UID 999 的源码而失败，未运行测试体。改用既有文件所有者 `999:999`，继续保留只读源码挂载和全能力丢弃，才得到上表的真实性能失败。首次耐久性测试的独立 `/tmp` 只有 128 MiB，正确触发课件存储的 256 MiB 安全门限；改用带实时水位保护的隔离真实磁盘暂存后原测试全部通过。两次基础设施失败回执都保留，不代表对应业务已失败或通过。

## 冻结版本的性能诊断

- 力学：夹具冻结编码 1920.15 ms，`verifyCanvasCapture` 3388.25 ms，完整对照及独立提取仍执行。精确版本的独立 Canvas [CPU 采样回执](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-canvas-profile-20261118T055453Z-e91765976b7801ab/result.json) 记录了重复 JSON 路径、对象验证和 canonical emit 的开销；采样不作为门禁通过。优化应保留所有字段、独立快照及精度。
- 密集笔迹：上传/提交约 2977.00 ms，创建助手约 4215.41 ms。首轮持久图验证必须保留；可以验证末尾再次打开全图是否可替换成同一权限、生命周期和并发防线内的最新 head 对照。另查已严格验 SHA 的读取是否又计算同一摘要。必须保留完整原始字节比较和恢复后的旧任务栅栏。
- 统计：10× 的 `facilityOpenMs` 为 1800.09 ms，其中真实 PostgreSQL `loadAll` 是 523.21 ms，`initializeMs` 是 293.02 ms；嵌套差值不能直接当作 schema 解析耗时。优先测量能否合并桶的去重计数和模块不变量校验，不删行、不开缓存绕过、不改变保留或重放规则。

## 后续源码试验（不可作为发布证据）

在同一个冻结构建的只读测试容器上，以校验过的文件挂载运行未提交的源码变更，未更新镜像、构建器或冻结回执。

- [画布四项复测](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-perf-canvas-20261118T063006Z-c751afbf7504630f/result.json)：完整力学重验 **4044.89 ms**，完整笔迹上下文 **3236.56 ms**，都低于原 5000 ms。删除/恢复后的旧任务拒绝和磁盘篡改后的摘要拒绝也通过。65 项焦点以外的用例未运行。画布改动保留在工作区，尚未冻结或重构建；原始点、压力、精度及完整图验证没有裁减。
- [统计容量试验](ssh://root@107.151.246.59/opt/physicsos/.physicsos-release/teaching-gate-capacity-20261118T062435Z-34e1e0f440cac0fd/result.json)：同一 33121 行十倍负载仍失败，冷启动 **2290.54 ms**，未进入十倍查询 p95。合并校验和简化日期解析的试验没有解除阻断，未纳入待发源码。应先改善真实 PostgreSQL 冷加载与验证路径，若无法在完整负载下稳定达标，按原方案做可索引存储；不降低阈值。

尚未执行完整 host 扫描、registry/export/冷镜像验证、真实私有候选与浏览器验收、main 合入或生产切换。当前生产不受影响。
