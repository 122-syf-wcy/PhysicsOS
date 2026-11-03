# 全部实验上传、渲染审核与自动展示

状态：全部76个实验的开发与私有候选验收完成，正式发布准备中；本轮尚未改动正式应用。用户明确要求全部实验，并沿用已授权的 GitHub 与部署流程。

## 已实现

- 实验上传页提供液态玻璃“对应实验”下拉框，全部76个已有实验均可选择。目标明确传入目录、上传和回滚请求，ZIP中的experimentId必须与所选实验一致。
- 管理后台“内容与通知 → 实验审核”只向SUPER_ADMIN开放；集中展示跨实验投稿，并按实验、状态筛选。直接加载上传包的冻结文件，通过对应物理运行时渲染预览，支持审核通过、退回和各实验独立回滚。
- 已批准作品自动成为对应实验的新场景默认展示；已有明确绑定的官方/社区版本保持原版本。显式官方版本恢复不依赖目录网络请求。
- 新增通用V3契约覆盖12个物理领域。物理结果仍由平台引擎计算，上传代码只消费只读快照和受约束的操作意图。默认SDK内置官方只读PhysicsCanvas；作者可提供Three/canvas展示，不执行上传代码来计算后台物理结果。
- 对应模板和完整开发提示词按所选实验提供。凸透镜保留已发布V2提示词/冻结模板的兼容入口，其余默认使用V3；V3也支持凸透镜。公开开发者页支持全部选择、复制、下载、任务说明和失败重试。
- 旧lens V1/V2包、activeId、存储行和恢复日志兼容保留；新增activeByExperiment控制各实验发布，不覆盖其他实验默认版本。

## 验证与证据

所有构建、测试和浏览器验收在107.151.246.59的Docker `physicsos-experiments-build`完成。本机只编辑源码、查看产物和整合Git。

| 范围 | 结果 |
| --- | --- |
| 宿主完整实验套件 | 156/156通过；后续定向routes14/14、strict V3 universal9/9通过 |
| canonical注册和SDK包 | 76个目标、12个领域；真实ZIP解析/确定性/隔离/未知ID等工具检查4/4通过 |
| 默认SDK实际渲染 | Chromium76/76，12个领域，无外部请求或浏览器错误；受影响3个目标再次通过 |
| SDK安装与发布 | pinhole下载源码全新安装、configure、连续两次release通过，字节一致；108文件、6,205,667字节的包验证通过 |
| 通用运行时/桥接 | 初始107项定向检查通过；最终universal84/84包含全部76健康默认与failed/NaN/Infinity边界；候选5/5、绑定恢复6/6等检查通过 |
| 波动引擎 | 38/38、类型/规范通过，修正既有纵波marker缺少位移导致图表NaN的问题 |
| 前端与后台入口 | 集成21/21通过；最终受影响16/16、类型与定向lint通过；旧V1/V2帧行为保留 |
| 文档页面 | 旧7/7浏览器检查通过；新V3检查通过全部76选择、目标模板、复制/头部/下载逐字一致、错误禁用、任务保留和手机无溢出 |
| 真实上传闭环 | 76选择入口；两实验的4个下载源码包修改renderer、构建、实际选文件提交；目标不匹配拒绝；后台真实源码效果、首帧/失败保护、独立发布、保存/仍打开的固定版本、归档摘要、桌面/390px和正常console均通过 |

实际E2E并非覆盖76次发布：所有76注册/包解析/默认渲染已检查，完整发布与恢复在小孔成像和串联电路跨领域代表上验证。V3案例预校验canonical输入和范围，不接受作者提供的物理计算结果作为可信依据；不声称穷举所有参数组合或全仓库审计。

主要日志：服务器 `/tmp/physicsos-all-ui-integration.log`、`physicsos-all-final-ui.log`、`physicsos-all-final-bundle.log`、`physicsos-universal-docs-green.log`；生成/实际渲染结果 `/tmp/physicsos-universal-renderer-check/result.json` 和 `physicsos-universal-renderer-final/result.json`；私有闭环存证 `/tmp/physicsos-v2-contract-review-20261103/all-experiment-acceptance-result.json`。脚本：[all-experiment-contribution.mjs](../../tests/acceptance/all-experiment-contribution.mjs)、[universal-developer-docs.mjs](../../tests/acceptance/universal-developer-docs.mjs)。17张候选截图在 `screenshots/all-experiment-contribution/`，已检查实际作品标记、移动审核按钮、发布和失败禁用效果。

## 实现与验收中修正

- 旧Doppler频率500Hz超出通用50Hz显示上限、双导体杆电阻0.1Ω低于0.5Ω显示下限：修正对应canonical控制边界并重新生成SDK，移除临时default豁免，76默认值都满足声明边界。
- 序列化保留既有非有限数拒绝机制，新拒绝failed物理状态；首帧渲染失败、失效版本和错实验ID不会获得通过按钮。
- V3动画改用真正帧源，不仅使用4Hz摘要；旧V1/V2接口不改变。
- Lightning CSS class-map键顺序不稳定，排序后生成字节可复现；新通用CRC采用Node24原生crc32并确认与旧编码器一致。
- 新文档重试失败时头部下载按钮仍可用的浏览器回归先失败后修正；统一按钮禁用和完整提示词内容，保留任务输入。
- 测试候选的Node HTTP/1.1六个SSE标签耗尽同源连接池，关闭一旧标签即恢复第六页，确认不是产品导航问题；实测限制同context最多4必要标签。正式nginx已使用HTTP/2。SwiftShader截图卡住属于候选GPU环境，V3默认SVG实测禁用GPU，无需改变产品或弱化渲染断言。

## 发布准备

基线源码为`6d277ef`，实际正式镜像为`sha256:d6f608e5a37ccbb45b0034e8064a67670045818d34ca96111001122f2885e061`，healthy。发布前再次核对main/服务器/镜像，保留原镜像、数据库与文件恢复点；候选镜像及PostgreSQL副本验收、独立审查、正式切换和GitHub最终记录将在收尾补齐。

## 独立审查收尾

审查范围`6d277ef..1730261`，记录见 [代码审查](2026-11-04-all-experiment-code-review.md)。结论可合并，无Critical/Important；两处非阻塞说明已修正：模板卡片改用所选实验名称，生成目标文件注释改为真实的`configure -- --version`命令。重新生成与`--check`通过，程序契约和物理模型不改变；没有把原始审查改写为重复审查。

生成SDK的Node类型擦除结果保留位置空白，部分原始许可证保留末尾空行；这是生成/许可证文件的字节保留行为，源码定向规范检查通过。审查未展开10MB模板base64及既有第三方渲染器，而依据生成器、校验器同源检查和实际浏览器证据判断；不作任意作者代码科学正确性的自动认证。发布与PostgreSQL副本检查仍由执行者完成。
