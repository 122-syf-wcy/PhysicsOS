# PhysicsOS Lab Collection

76 个已注册实验的独立协议 3 三维可视化包。物体位置、受力、光线、接线、波形和读数来自平台运行时；包仅绘制收到的事实并发送参数、选择和播放意图。

`src/scene-kit.js` 提供几何与材质，`src/renderer.js` 管理取景、灯光、标注和资源释放。领域模块分别实现真实器材，`src/main.js` 接入官方 MessagePort SDK。默认近景突出装置，正视和全程视图用于比较几何与运动；所有视角使用统一世界坐标比例。

2.1.0 增加嵌入布局：认证握手之后隐藏包内重复的标题、参数与播放，保留相机工具、画布和读数；宿主只有在包确认应用该布局后才调整容器。独立预览仍提供完整控件，旧包保持原布局。旧实验记录可显式升级外观，原参数和记录保留。

2.2.1 增加视角控制：滚轮或「＋／−」在 50%–400% 之间缩放，拖动旋转；打开「移动」或按住 Shift 拖动可平移，触屏支持双指缩放和平移。「复位」恢复默认装置视角和位置，「查看全程」重新适配全部轨迹。视角在播放、参数调整和窗口尺寸变化后保留，不改变物理数据。历史记录仍固定原包，需通过「使用新版实验外观」显式升级。

2.3.0 候选源码改为每显示实例保留场景和明确 entity/part 身份，稳定拓扑不再逐帧重建静态器材；动态几何仅更新实际采样缓冲。标签和读数复用节点，材质/纹理有明确所有权。WebGL 丢失、零尺寸和隐藏页暂停显示，恢复后重放同一可信帧，未绘制不发送成功 ACK，不新增科学时钟或求解器。此段记录实现方向；正式测试、76 个精确 ZIP 的未修改浏览器验收及新版本发布仍须执行，不能把源码存在称为已上线。

器材是既有教学模型的三维表达，不是通用三维刚体、流体或厚透镜求解。缝宽/强度、电动机力矩和光电装置通过可选语义字段读取，不从格式化文字、箭头像素或粒子路径反算物理量。旧记录继续固定原版本；新版默认指针与历史外观升级分别验证。

标签按稳定顺序尝试多个位置，重要受力优先，移位标签用引导线连接真实锚点。斜面局部视窗只画平台提供的真实轨迹采样，不补造越界运动。

构建在项目约定服务器的现有 Docker 中完成：

```sh
cd /app
# 先完成冻结 Git 源码投影、依赖验证和 physicsos-source-manifest.json 校验。
PHYSICSOS_LAB_VERSION=2.3.0 \
PHYSICSOS_LAB_RELEASE_DIR=/tmp/physicsos-lab-collection-2.3.0 \
  node scripts/developers/build-lab-collection.mjs
PHYSICSOS_LAB_RELEASE_DIR=/tmp/physicsos-lab-collection-2.3.0 \
PHYSICSOS_LAB_SHOTS=/tmp/physicsos-lab-collection-2.3.0-exact-shots \
  node tests/acceptance/lab-collection.mjs
```

构建器使用标准模板的 configure/check/build/validate/release 流程，写入当前真实引擎默认快照，冻结本地 Three.js 0.180.0 和全部资源；index 绑定冻结 revision/sourceDigest。单个 ZIP 自带对应源码、入口、元数据和许可证。可追加实验 ID 仅构建或验证选定目标；新的发布批次通过 `PHYSICSOS_LAB_VERSION` 指定版本。

正式物理 host 与 archive server 在服务器 Docker 中运行。可通过 SSH loopback 和 `PHYSICSOS_LAB_CDP` 连接独立浏览器；`PHYSICSOS_LAB_HTTP_PORT` 固定私有转发端口。仅创建并关闭当前测试的 browser contexts。`PHYSICSOS_LAB_RETAINED_PROBE=1` 为单独的生命周期/分配探针，会做可观测插桩；它不能替代未修改 ZIP 的正式验收，发布器明确拒绝仅插桩回执。合成 persisted 事件也不等于原生 BFCache 实测。

`publish-lab-collection.mjs` 默认只核对现有版本；显式 `--publish --evidence <验收记录>` 才执行标准上传与审核接口，并逐项核验默认 ID/SHA。该操作使用现有私密凭据文件，保存切换前指针，支持按相同内容摘要继续未完成批次。正式执行前还需建立服务器数据库/资源恢复点、完成宿主候选验证。`published-lab-collection.mjs` 从正式产品页面复查已发布包，不负责发布。

台面图片只表现材料表面，不包含任何物理事实；生成来源见 `public/assets/ASSET-NOTES.txt` 和 `SURFACE-PROMPT.txt`。其余器材和全部动态物理标注由代码生成。
