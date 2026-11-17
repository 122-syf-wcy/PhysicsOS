# 2026-11-17 正式发布验收记录

正式入口：https://physics.dongsiwei.com 。应用与 validation-worker 已完成配对备份、串行切换；76 套独立实验 2.3.0 已经正常投稿、审核并逐项核对 active 指针及原 ZIP 摘要。最终运行事实见 [release.json](release.json)。

## 版本与发布

| 项目 | 实际结果 |
| --- | --- |
| 运行源码 | `f6e7fb71fa7ae27e13b0f8f2db6c38202e171e9b` |
| 切换时服务器 / main | `7382a9501c5df15c7683ab1b4f86de2e16a4151d`；f6 之后仅测试 fixture 与发布工具修复，未重建运行镜像 |
| sourceDigest | `dc71bd38de6b5d072985aa6289b90cf566a360f4be21f92edc1e363c2a9b0f32` |
| 应用镜像 | `sha256:eddf40d1307b644db51edd995c98f731ecec8ee4cb668f7237447bbbba765bdc` |
| 校验镜像 | `sha256:e888ca49106c262defbe416bbbcc58ab8bd729a00d78ff8fe0a7a800d7d1f940` |
| 应用冷验 | 14,781 个管理文件、12 个签名插件；源码与已发布清单一致 |
| 正式切换 | exit 0，235.44 秒；root / readyz / 登录 / 账户范围 / 受保护读取全部通过 |
| 新恢复点 | `/opt/physicsos/backups/releases/20261117T042057Z-ui-f6e7fb71-v2` |
| 并行教师预览 | Nginx 文件 SHA 保持 `c50594edcd03535ed47333b13784252506bb59bd132e214dffa201d8f4ed7bab` |

首次发布在停服前拒绝旧 worker 的过期 Compose image 标签，未创建有效恢复点、未停止生产。修复只允许计划明确绑定的旧 CID，并同时要求 daemon `Image` 与 `Config.Image` 都是预期完整 SHA；新 CID 不适用此兼容。候选 source-digest 标签必须匹配冻结源。服务器发布工具回归 124/124、exit 0；随后 v2 正式切换成功。没有降低 seccomp、只读、非 root、cap、网络、镜像或 nonce 归属校验。

## 物理校验与无模型重验

- f6 的 worker 类型、67 项纯逻辑、50 项真实标准 V3 SDK / 原生几何浏览器检查均通过；运行在非 root、无网络、只读 rootfs、cap-drop ALL 且保留 Chromium sandbox 的隔离容器，输入和依赖前后摘要一致。见 [worker-browser.json](worker-browser.json)。
- 原先失败的同一工件按原 scene / revision / candidate SHA 重验，POST 200，5,213 ms，当前状态 `ready`、8/8 检查通过，attempt 仍为 1。题目初速度保留 `{x:0,y:20,z:0}`。没有重新生成工件或调用模型。
- 原重验脚本错误地要求 public job API 返回 `validationHistory`，因此原脚本 exit 1，回执仍保留为 [same-artifact-retry-raw.json](same-artifact-retry-raw.json)。public DTO 按设计不公开历史；只读 PostgreSQL 事务已证明原 lease 2 的失败报告完整保存在独立 `validation_history`，当前 lease 3 的通过报告绑定同一候选。旧 strict `jobs` 行没有新增历史字段。见 [history-readonly-proof.json](history-readonly-proof.json)。
- 后续正常登录并仅导出该 owned 会话，使用真实 `request/header` 事件口径核对：父请求 1、3 个子会话各 1、父工具调用 8，before / after 数量及摘要全部相同。见 [model-request-counts.json](model-request-counts.json)。旧 `llm/request` 的零计数不作为此结论依据。
- 同镜像候选的原对话已实际显示隔离验证通过；核心 smoke 包含实验播放暂停、助教单壳层与内部焦点 Escape、390px 出卷和学校管理员对三个超级管理员 API 的 403。见 [candidate-core-smoke.json](candidate-core-smoke.json)。

## 既有回归及保留失败

完整 UI 回归在 c68 冻结时为 181 个文件、2,317 项通过；同阶段真实 Pandoc / LibreOffice 公式和认证、工作台、官网管理持久化 / 409 / 恢复已通过。后续物理与 host/tool 改动分别进行了源码精确校验和定向回归，不将 c68 数量冒充 f6 全仓重新运行的结果。

f6 host/tool 批次保留两项问题：jobs 测试 fixture 重复声明，以及共享图用例实际 1,636 ms 未达到原 1,500 ms 门槛。fixture-only 提交 e575 后 jobs 59/59 通过；当时整文件仍有一次 1,881 ms 的耗时失败。见 [runtime-gates-retained-failures.json](runtime-gates-retained-failures.json) 与 [jobs-recheck-retained-timing-failure.json](jobs-recheck-retained-timing-failure.json)。最终在服务器 Docker 独立执行原共享图用例，未改源码、断言或门槛，exit 0、1/1 通过（其余 86 项按名称筛选未运行），见 [shared-graph-isolated.json](shared-graph-isolated.json)。这补足该单例的独立证据，不覆盖或抹除前两次失败，也不宣称受限服务器并发负载下稳定达到相同耗时。

## 76 套原始实验包

- 冻结实验源码 `0766d29dc6fb1d7dfba7baac365ab0e739652bf0`，sourceDigest `94518a8669f753f3062920e25fb2314260a7da9768635b25b278881aa47f6347`。
- 正常、未插桩的浏览器验收为 76/76，12 个领域、381 张截图；没有用 retained 仪器化批次替代正式证据。
- 归档 SHA `32d228fb3bfe3a061d8dc6756cfed9c875cd39705bffcfca8c5278d8a4dbd2fb`。在 256 MiB tmpfs 恢复原 ZIP，每个名称、字节数和 SHA 都与原索引一致；未重新构建或修改 ZIP。
- 原封不动官方 publisher 的 SHA 为 `97378dfd68e76df6a6c2e9d54377a151898f34e2296602c07fcb1cd82de20ef0`。通过正式登录、投稿与审核 API 发布，76/76 approved，exit 0；每包再次核对 active ID / SHA，见 [lab-publication.json](lab-publication.json)。
- 首次 before 指针表保存在服务器发布 output 中，SHA `2099f30efa02f01577bdca7e80685f0e0b9a721b729ca457d164127a7e286e99`；原版本为 2.2.0 / 2.2.1。完整结束回执见 [lab-publication-complete.json](lab-publication-complete.json)。实验回退应通过既有审核回退 API，使用该表的旧 packageId 和当前 expectedActiveId；不直接改数据库指针。
- 发布助手及其凭据内存副本已经按所有权清理，首次 before、全部逐包回执、原归档和验收证据仍保留。

## 配置、搜索与恢复

只读事务核对生产与候选的 channels / keys / settings，包括密封密钥：配置一致，只有 `lastUsedAt`、`requestCount`、`updatedAt` 不同。4 通道、4 key，3 启用通道、0 冷却、3 个可路由 key；未覆盖生产动态计数，未解密或保存密钥。见 [model-pool-parity.json](model-pool-parity.json)。

正式 app 网络命名空间对 SearXNG 主源进行真实无模型检索，HTTP 200、33 条结果，其中 22 条匹配单摆科学主题，见 [primary-search.json](primary-search.json)。此前独立 research service 的真实网络证据也已通过；本次检查不宣称又执行一次模型生成。

新 paired 恢复点的 PostgreSQL / 应用数据 / Redis / 原配置 / 10 份密钥恢复副本均核对摘要，两个 tar.gz 的全部成员可读，`pg_restore --list` 可读。旧应用 `93cb03…` 与旧 worker `b179e7…` 的完整镜像和回滚 tag 保留，见 [recovery-check.json](recovery-check.json)。没有在正式库执行恢复或回灌旧业务数据；这不是一次破坏性全量恢复演练。历史表的旧镜像兼容结论针对实际 PostgreSQL，不能外推到旧 JSON single writer。

## 空间与范围

入库实际保存原 ZIP 176,093,433 B 与 dist 81,809,007 B。执行前保留 128 MiB 余量及文件分配开销，未降低容量门槛。仅对确认无使用者且属于本任务的编译缓存与 a397 构建副本做无损归档，压缩前、解码后及删除展开副本前均逐文件核对 SHA；完整恢复命令和回执见 [compile-cache-preserved.json](compile-cache-preserved.json)、[old-context-preserved.json](old-context-preserved.json)。生产数据、已交互候选、旧镜像及恢复点未清理。归档后曾实测剩余约 166 MiB，磁盘容量仍有限。

未声称 62 个设计状态逐一人工批准、原生 BFCache、全部真机 GPU 性能或本次正式站全部角色账户重新验收。第一次正式浏览器脚本误用了候选专用教师账号，401 回执保留为 [production-fixture-login-retained-failure.json](production-fixture-login-retained-failure.json)；正式检查使用正式验收账号，不同步候选用户。正式页面交互结果将与最终安全回执一起保存。
