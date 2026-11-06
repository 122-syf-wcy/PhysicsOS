# PhysicsOS Lab Collection

76 个已注册实验的独立协议 3 三维可视化包。物体位置、受力、光线、接线、波形和读数来自平台运行时；包仅绘制收到的事实并发送参数、选择和播放意图。

`src/scene-kit.js` 提供几何与材质，`src/renderer.js` 管理取景、灯光、标注和资源释放。领域模块分别实现真实器材，`src/main.js` 接入官方 MessagePort SDK。默认近景突出装置，正视和全程视图用于比较几何与运动；所有视角使用统一世界坐标比例。

2.1.0 增加嵌入布局：认证握手之后隐藏包内重复的标题、参数与播放，保留相机工具、画布和读数；宿主只有在包确认应用该布局后才调整容器。独立预览仍提供完整控件，旧包保持原布局。旧实验记录可显式升级外观，原参数和记录保留。

标签按稳定顺序尝试多个位置，重要受力优先，移位标签用引导线连接真实锚点。斜面局部视窗只画平台提供的真实轨迹采样，不补造越界运动。

构建在项目约定服务器的现有 Docker 中完成：

```sh
cd /app
PHYSICSOS_LAB_VERSION=2.1.0 \
PHYSICSOS_LAB_RELEASE_DIR=/tmp/physicsos-lab-refinement-20261107 \
  node scripts/developers/build-lab-collection.mjs
PHYSICSOS_LAB_RELEASE_DIR=/tmp/physicsos-lab-refinement-20261107 \
PHYSICSOS_LAB_SHOTS=/tmp/physicsos-lab-refinement-shots \
  node tests/acceptance/lab-collection.mjs
```

构建器使用标准模板的 configure/check/build/validate/release 流程，写入当前真实引擎默认快照，冻结本地 Three.js 0.180.0 和全部资源。单个 ZIP 自带对应源码、入口、元数据和许可证。可追加实验 ID 仅构建或验证选定目标；新的发布批次通过 `PHYSICSOS_LAB_VERSION` 指定版本。

`publish-lab-collection.mjs` 默认只核对现有版本；显式 `--publish --evidence <验收记录>` 才执行标准上传与审核接口，并逐项核验默认 ID/SHA。该操作使用现有私密凭据文件，保存切换前指针，支持按相同内容摘要继续未完成批次。正式执行前还需建立服务器数据库/资源恢复点、完成宿主候选验证。`published-lab-collection.mjs` 从正式产品页面复查已发布包，不负责发布。

台面图片只表现材料表面，不包含任何物理事实；生成来源见 `public/assets/ASSET-NOTES.txt` 和 `SURFACE-PROMPT.txt`。其余器材和全部动态物理标注由代码生成。
