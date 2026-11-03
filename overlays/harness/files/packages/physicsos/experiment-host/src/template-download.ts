/** Trusted template bytes only. No submitted source is imported, installed or executed. */
import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import registry from './experiment-registry.json' with { type: 'json' }
import data from './universal-template-data.json' with { type: 'json' }

type TemplateData = {
  base: Record<string, string>
  targets: Record<string, Record<string, string>>
}
const templateData: TemplateData = data
let sharedFiles: Map<string, Buffer> | undefined

/** Deterministic ZIP encoder, identical to the standalone SDK's store-only format. */
function zipBytes(files: ReadonlyMap<string, Buffer>): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0
  for (const [path, bytes] of files) {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(path) ||
      path.startsWith('/') ||
      path.split('/').some(part => !part || part.startsWith('.'))
    )
      throw new Error('Invalid trusted template path')
    const name = Buffer.from(path)
    const crc = crc32(bytes)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(0x5d62, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(bytes.length, 18)
    header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, bytes)
    const index = Buffer.alloc(46)
    index.writeUInt32LE(0x02014b50)
    index.writeUInt16LE(20, 4)
    index.writeUInt16LE(20, 6)
    index.writeUInt16LE(0x800, 8)
    index.writeUInt16LE(0x5d62, 14)
    index.writeUInt32LE(crc, 16)
    index.writeUInt32LE(bytes.length, 20)
    index.writeUInt32LE(bytes.length, 24)
    index.writeUInt16LE(name.length, 28)
    index.writeUInt32LE(offset, 42)
    central.push(index, name)
    offset += 30 + name.length + bytes.length
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
/** Platform-owned source and dist files; each caller receives its own mutable map. */
export function experimentTemplateFiles(experimentId: string): Map<string, Buffer> {
  if (
    !registry.some(profile => profile.id === experimentId) ||
    !Object.hasOwn(templateData.targets, experimentId)
  )
    throw new Error('Unknown experiment template')
  sharedFiles ??= new Map(
    Object.entries(templateData.base).map(([name, body]) => [name, Buffer.from(body, 'base64')]),
  )
  const files = new Map([...sharedFiles].map(([name, bytes]) => [name, Buffer.from(bytes)]))
  for (const [name, body] of Object.entries(templateData.targets[experimentId] ?? {}))
    files.set(name, Buffer.from(body, 'base64'))
  for (const [name, body] of [...files]) {
    if (name.startsWith('public/')) files.set('dist/' + name.slice(7), body)
    if (name.startsWith('src/')) files.set('dist/runtime/' + name.slice(4), body)
  }
  return files
}
export function buildExperimentTemplate(experimentId: string): {
  bytes: Buffer
  filename: string
  sha256: string
} {
  const files = experimentTemplateFiles(experimentId)
  const bytes = zipBytes(new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
  return {
    bytes,
    filename: `physicsos-${experimentId}-template-v3.zip`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

/** A selected, reproducible instruction document users can copy to their coding agent. */
export function experimentDeveloperPrompt(experimentId: string): string {
  const profile = registry.find(item => item.id === experimentId)
  if (!profile) throw new Error('Unknown experiment template')
  const archive = buildExperimentTemplate(experimentId)
  return `# PhysicsOS 实验开发任务：${profile.label}\n\n请为平台已注册实验 ${profile.id} 开发一个可上传、可审核的独立浏览器实验包。领域：${profile.domain}。使用协议 3，并以对应下载模板为起点。\n\n模板下载：https://physics.dongsiwei.com/physicsos/experiments/${profile.id}/template\n文件名：${archive.filename}\nSHA-256：${archive.sha256}\n\n先下载并核对 SHA-256、解压，然后阅读 README.md、MODEL.md、experiment.json、parameters.json、teaching.json、cases.json、ASSET-LICENSES.json 和 src/protocol.js。无需另找实验求解器。默认包已经包含可工作的冻结平台参考渲染器，支持此实验的真实平台快照。\n\n## 开发边界\n\n- experimentId 固定为 ${profile.id}；engine.id 固定为 ${profile.domain}，contractVersion 为 1。schemaVersion 与 protocolVersion 都为 3；入口 dist/index.html；renderer 可为 platform、three 或 canvas。新内容使用 X.Y.Z 语义版本。\n- 参数与选择项必须保持下面的真实平台 ID、标签、单位、范围、步长与初始值。物理结果、轨迹、光线、受力、装置读数与验证由平台引擎计算，作者只绘制 snapshot.view 和相关只读字段。不得自行实现第二套 solver。\n- 使用 src/protocol.js 的 MessagePort SDK。握手严格核对 parent、hostOrigin、channel 与 protocolVersion 3，只接收一个端口。snapshot 绘制成功后确认原 frameId 与 snapshot.revision；失败报告 SNAPSHOT_INVALID 或 RENDER_FAILED。不得提前确认未完成的绘制。\n- 意图限定为 parameter/preview、parameter/commit、parameter/cancel、choice/set、observable/set、playback/running、playback/rate、playback/seek，均带 protocolVersion:3，并交回平台处理。\n- 所有模块、图片、字体、材质与模型随包放在 public/vendor 或 public/assets，使用同包相对引用。禁止 CDN、远端素材、绝对资源地址、动态依赖安装及网络求解。添加素材时同步声明 ASSET-LICENSES.json。\n- 修改 src/renderer.js 和 public/assets/experiment.css 完成视觉要求；可保持平台参考渲染器，也可替换为本地 Three.js/canvas。每个实验的适用条件由平台提供。teaching.json 写明确步骤和限制；cases.json 声明已注册输入，不添加 expected 来覆盖平台事实。\n\n## 当前平台配置\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n\n## 构建与提交\n\n使用 Node 24.7 或以上。执行 npm install；设置新版本：npm run configure -- --version 1.1.0。执行 npm run dev 检查固定平台快照的绘制；它不重算参数变化。执行 npm run release，必须完成源码检查、SDK 测试、干净构建、平台同源元数据验证与资源引用检查，再生成 release/physicsos-${profile.id}-<version>.zip 及 SHA-256 记录。不要手工打包旧 dist。\n\n最后给出 ZIP 路径、版本、SHA-256、实际检查结果和采用的素材许可。用户将 ZIP 上传到 PhysicsOS 的此实验入口，使用私有预览验证实时参数、显示项、播放和画布后提交管理员审核。\n`
}
