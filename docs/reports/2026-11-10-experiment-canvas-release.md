# 实验自由画布发布 — 2026-11-10

已按用户「继续快速部署」授权切换正式服务。

- 正式入口：https://physics.dongsiwei.com/#/canvases
- 服务器：107.151.246.59，正式项目 /opt/physicsos。
- 上线镜像：sha256:a2000f6b05a2447a1fc74ad348567af14ac6be4bacaf099df9a95304a97285ec。
- 完整代码产物摘要：bfe6539a83e49739b5216f93850db3fb1f96d2d195b14d507c3e3cfafbc0abc1。
- 保留生产基线：6d22340；整合最新 main 5ef868dd，保留账号审核与实验反馈修复。
- 容器 healthy；正式首页 HTTP200，/readyz HTTP200；画布 policy 接口未登录 HTTP401，符合账号权限要求。

## 验证

- 共享协议、图数据、JSON、CSV、合并及解析：775 项通过。
- 运行与捕获：215 项分批通过，包括完整104模板/实例流程；两项旧 -0/0 JavaScript 对比改为全量 canonical JSON 对比后补跑通过，所有数值、单位、身份、历史和失败报告断言保留。物理运行测试使用原30秒上限。
- 机械能移动演示及光学/同实例显示：9 项通过；引擎计划与契约187项通过。
- 实际 PostgreSQL：38项通过，无跳过。
- 画布数据、笔记生命周期、冲突恢复、资源策略、结果和入口组件均完成回归；入口/结果46项通过，账号验证历史6项通过。完整客户端首次冷装配在60秒 hook中预热，用户操作仍用5秒预算；跨浏览器完整图传输采用60秒合同预算。
- 严格类型检查通过；UI、learning-host、tool-physicsos bundle重建，沿用已有签名公钥重签12条插件记录。代码增量镜像明确补齐learning-host运行依赖连接。
- 隔离候选真实UI：登录、新建工作台、添加实验、编辑笔记、保存到账号、刷新恢复通过；零 pageerror。候选重新启动后原工作台仍可从账号读取。
- 管理工作树已提升到5ef868dd，1280文件overlay verify及git diff --check通过；原Desktop脏工作树未改；没有提交或推送。

## 恢复点

切换时停止旧app写入后，成对保存PostgreSQL与app_data，并保留旧镜像。

- /opt/physicsos/backups/releases/20261109T162345Z-canvas-q2mp10je
- /opt/physicsos/backups/postgres/20261109T162345Z-canvas-q2mp10je
- paired-recovery.json记录数据库/文件SHA256、旧/新镜像及代码摘要；config目录保留原.env、Compose和密钥恢复文件（私有权限，不进入版本库）。
- /opt/physicsos/.env仅更新PHYSICSOS_APP_IMAGE，正式Compose继续使用既有数据库、Redis、app_data和密钥挂载。

## 后续维护

按快速部署要求，未展开非功能性风格治理。旧冻结lint诊断中仍有新canvas文件的括号、行长、缩进和非空断言；此记录不代表最新lint全绿。上游全局i18n/domain/license检查有已存在的下游基线差异，未修改项目许可证或禁用规则来隐藏它们。

完整日志与候选源码保留在 /private/tmp/physicsos-canvas-q2mp10je；服务器构建资源及镜像保留便于追查。
