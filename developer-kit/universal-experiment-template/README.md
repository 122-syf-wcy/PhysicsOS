# PhysicsOS 通用实验开发包（协议 3）

下载包已绑定所选实验，直接执行 `npm install`、`npm run release` 可得到可上传 ZIP。Node 24.7 或以上；没有本机依赖时，请使用开发服务器的 Docker 环境。

- `npm run dev`：本地绘制固定的平台快照，检查样式与资源。它不会求解改动后的物理条件；实时参数测试在 PhysicsOS 上传预览中进行。
- `npm run configure -- --version 1.1.0`：设置新的语义版本。实验 ID 由下载包决定；其他实验请下载对应模板。
- `npm run check`：检查源文件语法与 SDK 边界测试。
- `npm run release`：检查、清理并构建 dist、调用平台同源元数据与资源验证器，再生成 `release/physicsos-<id>-<version>.zip` 和 SHA-256 发布记录。

编辑 `src/renderer.js` 和 `public/assets/experiment.css` 改善视觉；编辑 teaching.json 增加教学步骤。参考渲染器位于 public/vendor/platform-renderer.js，已冻结为本地资源，支持全部 12 个领域。换成 Three.js 时，将模块与素材放进 public/vendor 和 public/assets，使用相对引用并补充 ASSET-LICENSES.json。提交包不得依赖 CDN、远端图片、绝对资源地址或构建时执行用户包代码。

参数的 ID、单位、数值范围以及 choices 必须与 parameters.json 的平台配置一致。平台拥有 solver、装置物理量、view、inspector、clock、轨迹和验证结果。绘制错误应报告 RENDER_FAILED；成功绘制后必须确认同一 frameId 与 revision。MODEL.md 说明模型边界。
