# 对话题目代码实验

> 前期包装方案的记录保留作过程证据；最终独立画面与上线结论见 [独立题目代码实验验收](2026-11-04-independent-question-code.md)。

用户要求主对话调用子代理，为题目生成最新实验风格的代码可视化，并自主完成 GitHub 提交和上线。实现基线为 `68bd8d0`，正式服务器为 `107.151.246.59`，构建与测试均在既有 Docker `physicsos-experiments-build` 完成。

## 实现

- `physics_solve_question` 验证成功后自动调用专用代码子代理；`physics_generate_experiment` 支持已有场景和历史记录的手动再生成。
- 子代理继承主对话的模型路由，以最新 V3 对应实验规范及后台已发布的提示词正文为参考，只能调用 `structured_output`，交付标题、说明、renderer JS 和 CSS。空内部 preset 在首个模型请求前挂载，硬执行 guard 阻止其他工具；没有文件、终端、网页、问学生或继续委派能力。
- 生成代码经过长度、模块语法、导出、资源和封闭包检查后冻结为当前对话私有实验。原始题目场景、物理条件和已验证答案由平台引擎保留；社区实验默认版本不会改变。
- 聊天卡片使用新代码实验播放器、玻璃界面和参数控件，保留解题步骤、验证、播放与源码。显式打开实验使用同一题目的私有代码版本；代理场景同步不再自动切换到旧 Lab。
- 对话事件只保存状态和不可变身份，预览地址由登录账号重新授权。支持重载与服务重启；历史没有代码的记录显示生成入口，读取历史不会自动调用模型。
- 生成超时、取消、场景变更与并发任务有边界；封闭代码检查最多修复一次，失败可手动重试。

## 验证记录

实现阶段专项结果：宿主与身份38项、工具48项、UI原86项及新增恢复回归3项通过；抛体推导专项及完整 question-core449项通过。类型和包构建记录保留在服务器。最终编译 Web、真实聊天浏览器、候选镜像和 HTTPS 发布验证将在收尾追加。

独立审查发现的中断恢复问题已修复：生成事件携带兼容的 `deadlineAt`，旧记录缺期限或期限已过时提供显式再生成，读取历史不会自动调用模型。UI恢复专项11/11与工具48/48通过；后续题目的最新状态不会被过期生成结果改写。审查见 [记录](2026-11-04-chat-code-review.md)，未解决 Critical/Important 为0。

宽范围typed lint与编译并行曾触发1.8GB构建容器OOM；一次全host graph类型构建在1024MiB堆耗尽。随后调整为逐包独立编译、单进程定向规范检查，不放宽产品约束或改动正式运行环境。默认Vitest代理配置还曾在导入阶段报`node:`模块错误（0 tests），恢复专项改用既有client配置后，实际RED→GREEN结果为3失败/8通过→11通过。

真实抛体场景检查同时修正了既有两处问题：风格选择读取真实 `velocity.vector.y`；上抛解答显示对应的飞行时间公式，不再套用水平抛简式。数值答案仍来自引擎 SimulationResult，没有新增另一套求解器。

发布前核对 GitHub main、服务器 HEAD 和实际运行镜像均保持基线：源码 `68bd8d0`，镜像 `ddc1f1e0f2e3b4a53f110eed03f34fd5b9584310e0b8320728515acaa1028919`。候选镜像与数据库/文件副本验收后再切换，保留切换前镜像和数据恢复点。

密钥、Cookie、启动 token 和完整环境仅由既有文件或进程内部读取，不纳入日志、截图或版本库。供应商真实模型生成与脚本模型验收的结果分别记录，不混同。

## 最终构建与镜像边界

最终运行代码冻结为 `16f3932cb629c93cf0e71bcf417f99cf1be80abe`，包含原实现、交互/类型修复，以及下面记录的生成生命周期和模型传输修复。基础已验证物理/UI产物参考为 `bddb5a943407a98681c1e1a2219cac5dd6bb7f40`；之后发生变化的工具、preset、Web配置和 model-pool-host 根使用最新构建产物。服务器逐包 core/tool/auth/experiment 类型与 bundle、UI 类型/全部 optional bundle、Vite/Web、执行入口语法检查全部 exit0；初次日志 `/tmp/chat-final-build-resume.log`，最终 UI/Vite 与 tool 日志分别为 `/tmp/physicsos-chat-final-ui-complete.log`、`/tmp/physicsos-chat-final-vite-complete.log`、`/tmp/chat-code-cold-turn-bundle.log`。52项本次源码/测试文件与服务器逐文件 SHA 完全一致；最后工具两文件再次核对一致。

严格 typed lint 的完整40文件检查收尾仅剩2项，再对修改文件逐项修正并验证0 warnings/0 errors；最终工具两文件检查也为0/0。没有全局关闭类型规则；补齐了 `SessionProjectionStateMap` 声明，保留 JSON.stringify(undefined) 与原型方法 apply receiver 的明确边界说明。

真实浏览器交互暴露并修复了两个问题：初速度编辑现在缩放完整速度向量，25m/s仍保持90°，零速选角不会凭空产生1m/s，3个相关client文件38项通过；冷历史再生成现在把新状态挂到当前生成轮次，真实JSONL冷重启回归从错误的[1,1]改为[2,2]，19项生成测试通过。原场景、解答、修订、scene SHA和旧历史事件保持不变。

完整 `verify:overlay` 在既有构建目录报告566项 drift，涉及部分旧 overlay 副本缺失及 AppleDouble metadata；不声称完整镜像副本验证通过。实际发布以本次源码SHA、锁补丁精确应用与真实DDC运行镜像差异为边界，不将整个旧构建工作目录覆盖正式镜像。

首轮镜像差异门禁拒绝无关编译产物：468项新生成的 upstream/src JS/声明/map，以及非执行声明重排。逐项核对原TS源码未改后排除这些编译伴随文件；保留基础镜像原文件，相关类型声明仅精确纳入审计路径。3个既有绝对工作区链接转换为指向相同目录的相对链接，以支持可移动镜像。排除/归一化清单、最终逐文件与运行依赖验证在候选镜像存证中保留。

## 生成生命周期与真实模型

主代理成功求解后自动尝试一次本题代码生成。同父会话、scene/revision 和当前 turn 的 generating/failed/ready 状态无条件复用；追加展示要求、不同风格参数及重复 cached solve 都不能启动第二个同轮任务或清除成功结果。下一真实用户轮次可通过手动重新生成入口调整展示。最后两种 READY 回归在修改前均触发第二个 child；修改后专项32/32通过，root 再次运行得到32/32，日志 `/tmp/chat-code-hard-one-job-root-confirm.log`。两文件严格 typed lint 0 warnings/0 errors，类型与 bundle 均通过。

专用子代理根据实际模型公布的能力选择 off/none/minimal/low，输出上限8192，并尊重更低的主代理上限；主对话的 provider/model 和推理配置保持原设置。平台代理在确定真实上游模型后，仅对原生 DeepSeek 的明确 off/none 补充 `thinking: {type: 'disabled'}`，不影响其他模型或较高推理配置。model-pool-host完整88项、类型、bundle和typed lint通过。

真实供应商测试暴露了上述边界问题，失败记录保留：最初高推理配置发生两次180秒超时；缺少原生 thinking 字段的一次测试耗尽输出预算；`970e002` 增加传输转换能力后，首个真实子代理在95.16秒生成成功、源码与iframe可用，但主代理追加展示要求启动第二个任务并将最终状态覆盖为失败。该整题结果为 **FAIL（2 jobs）**，首任务成功不能代表整题通过。最后 `16f3932` 的无条件 READY 复用关闭这个缺口。其第一题真实测试只有1个job/child，仍在180.093秒后超时；该结果也保留为FAIL，没有用重复生成覆盖状态。

继续沿实际传输调查确认了配置根因：该路由使用 `physicsos-pool` 与localhost代理，SDK无法自动识别原生DeepSeek；模型条目 `reasoningEfforts.off: null` 使off不发送任何 `reasoning_effort`，默认预算字段为 `max_completion_tokens`。因此之前proxy的none条件实际上不会触发。失败child在3.148秒已收到首stream，后续一直为reasoning-only；一次TRANSPORT重试后共享180秒期限耗尽，并非首响应迟迟不来。

使用候选实际PiAiAdapter与SDK、dummy key和本机模拟HTTP捕获（无真实模型调用）确认：before off只发送 `max_completion_tokens:8192`，reasoning_effort/thinking缺失；仅将该模型off映射设为 `none`、`compat.maxTokensField`设为 `max_tokens` 后，严格配置解析接受，after发送 `max_tokens:8192` 和 `reasoning_effort:none`，proxy再补原生 `thinking:disabled`。high仍发送high、不添加thinking；模型ID、路由、父推理配置及预算数值不变。候选只修改该模型的两字段，备份原私有配置；修正后进行一次必要的真实验证，不无条件多发题。

完整脚本模型 Web 验收已通过12个门禁，覆盖真实认证、主代理与受限子代理、精确原题场景、源码与实际子工具输出一致、25m/s保留90°、私有Lab、跨账号/管理员/摘要拒绝、社区版本指针保持、reload、真实Web重启、冷历史再生成、唯一代码修复和旧历史手动生成。该结果属于脚本模型验收，不能代替供应商真实模型性能结果。

## 最终候选

候选镜像为 `physicsos-app:chat-code-16f3932`，精确身份 `sha256:9a776db98bee82f663c882414e747436b270393c72237f102eb1b2241c3a88ac`。完整校验通过105,694个文件 SHA、9,534个精确链接（9,532个容器内部canonical链接与2个字节不变的基础镜像dev-only悬空链接）、83个直接依赖解析、7个服务包default export加载及native flock。最后52个意图内源码/测试/配置文件重新与服务器核对，0差异。

候选使用还原的独立 PostgreSQL `physicsos_chat_code_20261104` 和文件根；production未参与模型验收或候选写入。实物验证记录在服务器 `/opt/physicsos-previews/chat-code-release-20261104/final-16f3932-operational-validation.json`。与上一970候选相比仅5项工具index源码、bundle和map条目变化。

最终镜像执行真实容器重启后，5个只读API调用对照重启前基线：完整artifact记录、renderer/CSS和风格哈希一致，签名预览重新授权成功，wrapper返回200，持久恢复门禁通过。此验证没有模型请求。证据分别保存在截图目录的 `artifact-before-final-restart/artifact-inspection.json` 与 `artifact-after-final-restart/artifact-inspection.json`。

模型级兼容配置修正后，同一题的唯一真实child在175.924秒内完成 `structured_output` 并冻结为ready，输出2674 tokens、没有reasoning块。主对话首次求解前耗时72.87秒，因此原210秒浏览器总门禁先到期；该最初门禁保留为FAIL，不能代表child超过180秒期限。随后只读取这同一个session/artifact补验页面，不另发题。父文字回复的后续等待与子任务成功分别记录，不将其称为完整回复性能通过。

同一session的真实页面补验已通过：source逐字等于真实child输出，20m/s、90°、g9.8与引擎20.41m/4.08s保持，实际community首帧ready，浏览器异常0。补验没有新prompt，父结束记录实际为completed。证据在 `final-16f3932-native-compat-verified/acceptance-result.json`。截图随后暴露基础CSS被短补充CSS替换，标题/字体退化；这是独立的视觉缺陷，修复方案是在私有包中冻结V3基础CSS并先加载，再加载作者CSS，原child源码与source API保持一致。最后通过已有真实代码重放验证此修复，不增加供应商请求；实际结果在执行后追加。

配置独立于镜像存储在app数据的profile中。正式脚本先停止app、完成数据库与文件备份，再由guarded helper只修改两个已审查字段，并保存原配置字节；失败及手动回滚先恢复原配置再恢复旧镜像。隔离helper验证覆盖精确修改/恢复SHA、999:999与0600、拒绝外部新修改且零写入，以及三个shell脚本语法。主对话high与32768预算保持原数值。
