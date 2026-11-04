> 当前状态：实现已提交并在服务器构建；真实生图成功，但端到端代码交付/视觉门禁未通过，未上线。最终运行源码2f5d26f，生产仍68bd8d0。

# 题目实验子代理运行时生图

用户于2026-11-04否决此前6dd1654候选画面，要求PhysicsOS的agent调用应用内配置的生图模型。旧候选不发布，生产保持68bd8d0/DDC。

现有/run/secrets/image_api_key非空，配置网关https://image.haqiuhaqiu.xyz的/v1/models验证HTTP200，包含gpt-image-2.5-sunburst。复用现有挂载，没有复制聊天中的密钥。Compose显式提供非秘密base/model默认值。

新代码子代理按当前已发布Warm Lab正文调用physics_generate_experiment_asset后再提交原四字段代码。工具仅在正在生成的专用子代理上下文注册，身份/题目/job来自父真实事件，不能由模型输入；主代理工具集不增加生图权限。图片用途限定environment/material，物理位置/轨迹/读数仍由引擎事实提供。

每job最多2次请求（失败也计数），每次180秒，共享任务600秒。输出8192与主模型/high保持。图片接口固定配置来源；不打印供应商错误正文；只允许PNG、6MiB、4096边长/8M像素，并校验CRC和解压长度；URL下载只接受同网关HTTPS且不附授权、不跟重定向。私有图片绑定owner/session/job/scene SHA，纳入原包哈希、许可与来源记录。源码四字段保留原字节，跨账号/任务/题目引用拒绝。

验证：drawImage目标几何RED4fail/3pass→GREEN7；实际child生图工具RED未调用→GREEN；最终工具71/71，宿主229/229，类型编译通过。完整宿主初次1失败来自许可metadata source不是URL，已修正并全套通过。构建、真实生成和最终视觉结果待追加。

两名实现子代理429中止、独立审查503中止，未把失败分工当作完成；主要实现与检查由根代理执行。

## c4bad23首次真实链路

真实PhysicsOS子代理成功调用physics_generate_experiment_asset，gpt-image-2.5-sunburst返回1536×1024图片，SHA256为6ed885fb285bd072e493a97efc308c491ab04314d90a73016c0fb617a9570b7c。工具结果只有私有包路径/尺寸/哈希/用途/模型，未泄露供应商地址或密钥。

随后模型只回复“I have the environment asset. Now I'll write…”并停止，没有structured_output；子代理driver将缺失结构化结果标为error，整题CHILD_INCOMPLETE。因此此轮只证明真实生图工具成功，不能代表最终实验交付。新增回归复现1fail/41pass；处理该明确分支使用现有唯一修复机会，复用同job图片，不再生图，仍受600秒/2次图片额度限制。未修改子代理记录或伪造源码。

修复版本187502b：工具完整72/72、类型/bundle/typed lint通过0/0。此前c4bad23镜像完整校验105709文件与9534链接通过，60源码与服务器SHA相同；187502b的两文件增量SHA再次相同。发布仍待实际画面通过。

187502b整题仍失败：真实生图成功后，代码响应多次上报6144输出tokens但没有工具参数/正文，provider返回EMPTY_RESPONSE；没有把这类空输出算作代码成功。7c21c64把渲染要求改为50–80行/2000–3000tokens，已有素材的修复child只提供structured_output，仍不增预算/次数。回归RED1fail/42pass→完整tool73/73、类型/bundle/lint0/0。

构建缓存清理：docker builder prune释放555.2MB，仅清理可重建cache，所有镜像与生产数据/恢复点保留。旧镜像校验清单与context无损压缩可恢复。

独立审查指出的素材引用/PNG有效性问题已修复：仅接受去注释后的字面src/setAttribute或CSS url引用，注释/unused字符串不再算使用；PNG检查scanline filter、关键块、IDAT顺序等，超限与非成功下载取消body。新增回归先3失败/6通过，修后17专项通过、完整host231/231。子源码缺export在structured_output执行前返回明确错误，实际provider回归验证原调用内重提交；工具73/73。空输出且最终PI_AI_ERROR保留失败策略，不无限追加repair。

代码响应多次缺失输出，新增专用代码schema的wire tool_choice:required：仅匹配structured_output的title/summary/rendererJs/stylesheet四string字段、完整required、工具列表只含此项和可选physics_generate_experiment_asset。其他schema、其他工具和显式tool_choice不改变。真实HTTP回归先1失败/26通过，后续完整验证记录待追加。

058e528包含审查修复和required工具交付。完整host231、tool73、pool89测试通过；类型、三个运行包构建及typed lint通过。旧深蓝/旧素材失败候选均未发布，生产仍保持68bd8d0。

058e528真实child已成功生图并提交导出的完整源码，但host返回泛化INVALID_SOURCE。原始源码只读回放定位为for-of绑定正则在mergePoints(view.keyPoints || [])的内层右括号处截断，导致Unclosed drawing function。新增正反回归先1fail/9pass，修正为复用已有平衡括号解析；原始源码不改动即可通过独立drawing guard。原整题repair遇空响应，最终未ready，仍保留失败。

空间收尾：校验完整context归档存在、镜像未被任意容器引用及DDC基础标签后，删除14个旧失败chat-code候选标签/镜像，保留当前生产、当前候选和上一候选。每项原image ID及可重建archive见服务器retired-rejected-candidate-images.safe.json；数据恢复点保留。可用空间回升835MiB。

acf0970镜像已通过105711文件完整校验、原始真实源码校验复放通过。该版本首次真实验收在生图之前遭代码通道HTTP200 SSE内error，parent后续回复也同错；均为0输出tokens，产品CHILD_INCOMPLETE，未发布。当前处理为确认外部通道健康，不重复完整付费任务。

代码通道最小非思考请求恢复200/OK。为减少无关指令，新增按当前物理域选择精确类型声明及递归依赖的prompt上下文，保留完整原题/解答；已发布视觉与代码规范逐字保留，仅排除无关上传打包流程。工具75/75，契约选择回归确认原字段与传递类型仍存在、其他领域字段去除。

## 当前阻塞与恢复入口

2f5d26f候选镜像：physicsos-app:chat-code-2f5d26f，sha256:837bee3df3023513f8da0e25aa6e859ab2a31f1ba07f4999dba58b66e5ee8f5c。105716文件SHA、9534链接、83依赖校验通过；工具75/75、宿主233/233、代理89/89，类型/bundle/lint通过。

第一题session-c8744a1a-3c15-4bde-948e-cfbd93076272在主模型调用物理工具前收到HTTP200 SSE error，0输出，浏览器等待已停止并记录upstream-terminal.safe.json。随后直接对既有通道作256-token工具探测成功（structured_output/finish tool_calls），没有更改配置。恢复后的整题session-dfaa855b-0678-4e88-88d3-bbac2ed8bed5，child082b2351-9471-4ce7-9281-31d5e8a7d4f3真实生图成功；下一代码响应input16849/output6144，仅2字符空白，未structured，CHILD_INCOMPLETE。仍不把模型报出的token usage当作实际可用代码。

未写candidate-accepted-image.txt，未快进远端main/服务器main，未切换生产。要完成发布，需当前代码模型稳定交付完整工具结果，或者用户提供/配置其他可用代码模型通道；生图网关和gpt-image-2.5-sunburst已经真实验证。下一执行者应先读本报告与服务器release目录，不能重新从旧深蓝方案开始，也不能把模板/手写源码冒充真实child结果。

服务器release：/opt/physicsos-previews/chat-code-release-20261104；真实测试脚本tests/acceptance/chat-code-experiment.mjs。现候选/DB/files副本可用，production/main68bd8d0镜像DDC健康。已准备配对备份、两字段model-wire配置迁移、回滚脚本，全部尚未正式执行。图片+代码重启验证入口tooling/physicsos-agent-image-persistence.py要求passed真实验收，当前不得绕过。
