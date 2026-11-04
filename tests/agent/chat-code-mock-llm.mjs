#!/usr/bin/env node
/** Deterministic Messages provider for the real parent → restricted code-child Web walk. */
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CHAT_CODE_QUESTION = '物体以初速度 20 m/s 竖直向上抛出（抛射角 90°），g = 9.8 m/s²。求最大高度、飞行时间和射程。'
export const CHAT_CODE_MARKER = '向上二十 · 本题独立画面'
const digest = value => createHash('sha256').update(value).digest('hex')
const blocksText = value => typeof value === 'string' ? value : (value ?? []).map(block => block.text ?? '').join('\n')
const messagesText = messages => (messages ?? []).map(message => blocksText(message.content)).join('\n')
const sceneOfPrompt = prompt => {
  const body = /题目场景（唯一物理条件来源）：([^\n]+)/.exec(prompt)?.[1]
  return body === undefined ? undefined : JSON.parse(body)
}

/** Native Canvas scene and controls; all motion/measurements remain platform-owned. */
export const CHAT_CODE_SOURCE = Object.freeze({
  title: '向上二十：一次竖直飞行',
  summary: '独立绘制玻璃飞行舱、真实球体轨迹与关键点；位置、时间、条件和读数全部来自平台快照。',
  rendererJs: `let latest
let stage
let drawing
const controls = new Map()
function node(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}
function intent(detail) { document.dispatchEvent(new CustomEvent('physicsos-experiment-intent', { detail })) }
function createStage() {
  const host = document.getElementById('canvas')
  stage = node('section', 'flight-studio')
  stage.id = 'question-independent-scene'
  drawing = document.createElement('canvas')
  drawing.id = 'question-independent-canvas'
  drawing.setAttribute('role', 'img')
  drawing.setAttribute('aria-label', '玻璃飞行舱中的竖直上抛')
  const heading = node('header', 'studio-heading')
  heading.append(node('span', 'eyebrow', 'MOTION STUDY  /  01'), node('h1', '', '${CHAT_CODE_MARKER}'), node('p', '', '从起点到最高处，观察每一个真实瞬间。'))
  heading.id = 'question-authored-marker'
  const readings = node('section', 'studio-readings')
  for (const [id, label] of [['height','当前高度'],['time','播放时间'],['maxh','最大高度']]) {
    const tile = node('div', 'reading-tile')
    const output = node('output'); output.id = 'question-authored-' + id
    tile.append(node('span', '', label), output); readings.append(tile)
  }
  const toolbar = node('section', 'studio-controls'); toolbar.setAttribute('aria-label', '独立实验玻璃控件')
  const play = node('button', 'play-button', '播放'); play.id = 'question-authored-play'
  play.setAttribute('aria-label', '播放本题实验')
  play.onclick = () => intent({ type:'playback/running', protocolVersion:3, running:!latest.clock.running })
  const seek = node('input'); seek.type = 'range'; seek.id = 'question-authored-seek'
  seek.setAttribute('aria-label', '本题播放进度'); seek.min = '0'; seek.step = 'any'
  seek.oninput = () => intent({ type:'playback/seek', protocolVersion:3, time:Number(seek.value) })
  toolbar.append(play, seek)
  const params = node('section', 'studio-parameters'); params.setAttribute('aria-label', '独立画面条件')
  params.id = 'question-authored-parameters'
  stage.append(drawing, heading, readings, toolbar, params)
  host.replaceChildren(stage)
}
function paint(snapshot) {
  const view = snapshot.view
  const body = view.bodies[0]
  if (!body || !Array.isArray(view.trajectories)) throw new Error('Missing platform experiment geometry')
  const w = drawing.clientWidth || 900, h = drawing.clientHeight || 620
  const ratio = Math.min(devicePixelRatio || 1, 2)
  drawing.width = Math.round(w * ratio); drawing.height = Math.round(h * ratio)
  const ctx = drawing.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable')
  ctx.setTransform(ratio,0,0,ratio,0,0)
  const background = ctx.createLinearGradient(0,0,w,h)
  background.addColorStop(0,'#161e34'); background.addColorStop(0.5,'#1c1734'); background.addColorStop(1,'#0b1524')
  ctx.fillStyle = background; ctx.fillRect(0,0,w,h)
  const toolbar = stage.querySelector('.studio-controls')
  const heading = stage.querySelector('.studio-heading')
  const center = w * 0.51, floor = toolbar.offsetTop - 26
  const ceiling = Math.max(h * 0.25, heading.offsetTop + heading.offsetHeight + 12)
  const scale = Math.min(w * 0.78 / view.extent.width, Math.max(45, floor - ceiling) / view.extent.height)
  const project = point => ({ x:center + point.x * scale, y:floor - point.y * scale })
  const light = ctx.createRadialGradient(center,h*0.35,0,center,h*0.35,w*0.6)
  light.addColorStop(0,'#be9cff24'); light.addColorStop(1,'#be9cff00')
  ctx.fillStyle=light; ctx.fillRect(0,0,w,h)
  ctx.strokeStyle='#b5bdd822'; ctx.lineWidth=1
  for (let i=-5;i<=5;i++) { ctx.beginPath();ctx.moveTo(center+i*w*0.075,floor);ctx.lineTo(center+i*w*0.15,h);ctx.stroke() }
  ctx.fillStyle='#07111d'; ctx.beginPath();ctx.ellipse(center,floor+8,w*0.26,h*0.035,0,0,Math.PI*2);ctx.fill()
  ctx.strokeStyle='#d7b4ff44';ctx.beginPath();ctx.ellipse(center,floor+8,w*0.26,h*0.035,0,0,Math.PI*2);ctx.stroke()
  ctx.strokeStyle='#dbbaff22';ctx.lineWidth=2
  ctx.beginPath();ctx.moveTo(center-w*0.23,floor);ctx.lineTo(center-w*0.23,h*0.20);ctx.lineTo(center+w*0.23,h*0.20);ctx.lineTo(center+w*0.23,floor);ctx.stroke()
  for (const trajectory of view.trajectories) {
    if (!trajectory.points.length) continue
    ctx.beginPath(); trajectory.points.forEach((point,index)=>{const p=project(point);if(index===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)})
    ctx.strokeStyle='#ceadff';ctx.lineWidth=3;ctx.shadowColor='#d5b4ff';ctx.shadowBlur=15;ctx.stroke();ctx.shadowBlur=0
  }
  ctx.font='12px system-ui';ctx.textAlign='left';ctx.fillStyle='#bfc7de'
  for (const point of view.keyPoints || []) {
    const p=project(point.at);ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#ffe3b3';ctx.fill()
    ctx.fillStyle='#c6cee2';ctx.fillText(point.label,p.x+15,p.y+4)
  }
  const p=project(body.at), radius=Math.max(11,Math.min(23,body.size*scale*0.65))
  ctx.fillStyle='#9b78db28';ctx.beginPath();ctx.ellipse(p.x,floor+9,radius*1.9,radius*0.38,0,0,Math.PI*2);ctx.fill()
  const sphere=ctx.createRadialGradient(p.x-radius*0.35,p.y-radius*0.4,1,p.x,p.y,radius)
  sphere.addColorStop(0,'#fff6ea');sphere.addColorStop(0.35,'#eed7bc');sphere.addColorStop(0.72,'#b29a91');sphere.addColorStop(1,'#665a76')
  ctx.fillStyle=sphere;ctx.shadowColor='#dcc2ff';ctx.shadowBlur=18;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0
  drawing.dataset.bodyY=String(body.at.y);drawing.dataset.clockTime=String(snapshot.clock.time)
  document.getElementById('question-authored-height').textContent=body.at.y.toFixed(2)+' m'
}
export function renderFrame(snapshot) {
  if (snapshot.domain !== 'mechanics' || !snapshot.view || !snapshot.clock) throw new Error('Expected authoritative mechanics snapshot')
  latest=snapshot
  if (!stage) createStage()
  const parameters=snapshot.inspector.flatMap(section=>section.parameters || [])
  const derived=snapshot.inspector.flatMap(section=>section.derived || [])
  const root=document.getElementById('question-authored-parameters')
  for (const parameter of parameters) {
    if (!['speed','angle','gravity'].includes(parameter.id)) continue
    let input=controls.get(parameter.id)
    if (!input) {
      const label=node('label','parameter-tile',parameter.label+' ('+parameter.unit+')')
      input=node('input');input.type='number';input.id='question-authored-'+parameter.id+'-input'
      input.onchange=()=>{const value=Number(input.value);if(Number.isFinite(value))intent({type:'parameter/commit',protocolVersion:3,id:parameter.id,value})}
      const output=node('output');output.id='question-authored-'+parameter.id
      label.append(input,output);root.append(label);controls.set(parameter.id,input)
    }
    input.value=String(parameter.value);input.step=String(parameter.step || 'any')
    if (parameter.min!==undefined)input.min=String(parameter.min)
    if (parameter.max!==undefined)input.max=String(parameter.max)
    document.getElementById('question-authored-'+parameter.id).textContent=parameter.value+' '+parameter.unit
  }
  document.getElementById('question-authored-time').textContent=snapshot.clock.time.toFixed(2)+' s'
  const maximum=derived.find(item=>item.id==='maxh')
  document.getElementById('question-authored-maxh').textContent=maximum?maximum.value+' '+maximum.unit:'—'
  const seek=document.getElementById('question-authored-seek');seek.max=String(snapshot.clock.total);seek.value=String(snapshot.clock.time)
  const play=document.getElementById('question-authored-play');play.textContent=snapshot.clock.running?'暂停':'播放';play.setAttribute('aria-pressed',String(snapshot.clock.running))
  paint(snapshot)
}
`,
  stylesheet: '.flight-studio{position:relative;width:100%;height:100%;overflow:hidden;color:#edf0ff;font-family:system-ui,sans-serif}.flight-studio>canvas{position:absolute;inset:0;width:100%;height:100%}.studio-heading{position:absolute;top:30px;left:32px;pointer-events:none}.eyebrow{font-size:10px;letter-spacing:.20em;color:#b8a4e5}.studio-heading h1{margin:10px 0;font-size:25px;font-weight:550;letter-spacing:.02em}.studio-heading p{margin:0;font-size:12px;color:#a8b4cc}.studio-readings{position:absolute;top:32px;right:28px;display:grid;gap:8px}.reading-tile{display:grid;gap:4px;padding:11px 14px;min-width:118px;border:1px solid #d3dafa20;border-radius:15px;background:linear-gradient(135deg,#ccd6ff17,#7b69b611);backdrop-filter:blur(12px);box-shadow:inset 0 1px 0 #fff1}.reading-tile span{font-size:10px;color:#a7b4cd}.reading-tile output{font-size:18px;letter-spacing:.04em;font-variant-numeric:tabular-nums}.studio-controls{position:absolute;left:28px;right:28px;bottom:97px;display:flex;align-items:center;gap:18px;padding:11px 14px;border:1px solid #e3ddff2b;border-radius:19px;background:linear-gradient(135deg,#d7dafa21,#a892db13);backdrop-filter:blur(18px);box-shadow:inset 0 1px 0 #fff2,0 12px 25px #07091a33}.play-button{border:1px solid #f3dbb953;border-radius:12px;padding:10px 20px;background:linear-gradient(150deg,#f1dcc7,#cbb9d9);color:#252338;font:600 12px system-ui;cursor:pointer}.studio-controls input{flex:1;accent-color:#c8a5f4}.studio-parameters{position:absolute;bottom:18px;left:28px;right:28px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.parameter-tile{display:grid;grid-template-columns:1fr 58px;gap:5px 10px;align-items:center;padding:10px 14px;border:1px solid #cbd2f424;border-radius:15px;background:linear-gradient(120deg,#c8d5ff14,#ae8cde12);font-size:10px;color:#aebcd5;backdrop-filter:blur(15px);box-shadow:inset 0 1px 0 #fff1}.parameter-tile input{grid-column:2;grid-row:1/3;width:58px;padding:8px 2px;text-align:center;background:#080d1d55;border:1px solid #cfbeec33;border-radius:9px;color:#eae4ff;font:14px system-ui}.parameter-tile output{font-size:12px;color:#e7dfff;font-variant-numeric:tabular-nums}@media(max-width:620px){.studio-heading{left:16px;right:16px;top:20px}.studio-heading h1{font-size:14px;margin:6px 0}.studio-heading p{display:none}.studio-readings{top:88px;left:16px;right:16px;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.reading-tile{min-width:0;padding:8px 5px;border-radius:11px}.reading-tile span{font-size:8px}.reading-tile output{font-size:12px;letter-spacing:0}.studio-controls{left:16px;right:16px;bottom:18px;padding:9px;gap:10px;border-radius:15px}.play-button{padding:9px 11px;white-space:nowrap;flex-shrink:0}.studio-controls input{min-width:0;width:100%}.studio-parameters{display:none}}',
})

function stream(response, { tool, input, text, id }) {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const event = data => response.write('data: ' + JSON.stringify(data) + '\n\n')
  event({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'scripted-physics-code', content: [], usage: { input_tokens: 100, output_tokens: 0 } } })
  if (tool) {
    event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `${id}-call`, name: tool, input: {} } })
    event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
  } else {
    event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  }
  event({ type: 'content_block_stop', index: 0 })
  event({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: tool ? 300 : 100 } })
  event({ type: 'message_stop' })
  response.end()
}

export async function startChatCodeMock({ port = 0, evidenceFile, sourceOverride } = {}) {
  const requests = []
  let mode = 'good', epoch = 0, epochChildren = 0
  let saveTail = Promise.resolve()
  const save = () => saveTail = saveTail.then(async () => {
    if (!evidenceFile) return
    await mkdir(dirname(evidenceFile), { recursive: true })
    await writeFile(evidenceFile, JSON.stringify({ mode, epoch, requests }, null, 2), { mode: 0o600 })
  })
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, 'http://local')
      const json = value => { response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }
      if (url.pathname === '/__chat-code/evidence') { json({ mode, epoch, requests }); return }
      let raw = ''
      for await (const bytes of request) raw += bytes.toString()
      if (url.pathname === '/__chat-code/control' && request.method === 'POST') {
        const control = JSON.parse(raw)
        if (!['good', 'invalid-always', 'repair-once'].includes(control.mode)) throw new Error('Unknown scripted mode')
        mode = control.mode; epoch += 1; epochChildren = 0
        await save(); json({ mode, epoch }); return
      }
      if (request.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) {
        response.writeHead(404); response.end('not found'); return
      }
      const body = JSON.parse(raw)
      const names = (body.tools ?? []).map(tool => tool.name).sort()
      const prompt = messagesText(body.messages)
      const system = blocksText(body.system)
      const isChild = names.includes('structured_output') || system.includes('PhysicsOS internal code run')
      const results = (body.messages ?? []).flatMap(message => typeof message.content === 'string' ? [] : message.content ?? []).filter(block => block.type === 'tool_result')
      const record = { request: requests.length + 1, epoch, mode, kind: '', tools: names, systemSha256: digest(system), firstCodeRequest: isChild && !results.length }
      let reply
      if (isChild) {
        epochChildren += 1
        record.kind = 'code-child'
        record.scene = sceneOfPrompt(prompt)
        record.personaRestricted = system.includes('专用题目实验代码作者')
        record.latestV3 = prompt.includes('Independent private question renderer data contract (V3)') && prompt.includes('snapshot.view') && prompt.includes('protocolVersion: 3')
        record.independentContract = prompt.includes('zero imports') && prompt.includes('There is no renderer factory or platform draw function')
        record.publishedStyle = /发布风格版本：([^\n]+)/.exec(prompt)?.[1]
        record.hasVerifiedAnswer = prompt.includes('已验证解答：') && !prompt.includes('已验证解答：null')
        record.repair = /本次为(?:同一任务的)?唯一修复机会/.test(prompt)
        const source = mode === 'invalid-always' || (mode === 'repair-once' && epochChildren === 1)
          ? { ...CHAT_CODE_SOURCE, rendererJs: "import 'https://invalid.example/remote.js'\nexport const renderFrame = () => {}" }
          : sourceOverride ?? CHAT_CODE_SOURCE
        record.sourceSha256 = digest(source.rendererJs)
        reply = { tool: 'structured_output', input: source }
      } else if (names.includes('physics_solve_question')) {
        const latest = (body.messages ?? []).filter(message => message.role === 'user').at(-1)
        const latestText = blocksText(latest?.content)
        if (results.length && latest?.content?.some?.(block => block.type === 'tool_result')) {
          record.kind = 'parent-final'
          const solved = results.map(result => blocksText(result.content)).find(text => text.includes('已求解（'))
          record.toolResult = solved
          reply = { text: solved ? '已按物理引擎校验结果作答。\n' + solved.split('\n').filter(line => /^(已求解|已知：|待求：|答案：|- |校验：)/.test(line)).join('\n') : '本题代码实验生成请求已处理，原题物理条件与答案已保留。' }
        } else if (/physics_generate_experiment|重新生成本题实验|生成本题实验/.test(latestText)) {
          record.kind = 'parent-generate'
          const sceneId = /sceneId\s*(?:[:=]|必须为)\s*["']?([\w-]+)/.exec(latestText)?.[1] ?? /场景\s*["'「“]?([\w-]+)/.exec(latestText)?.[1]
          if (!sceneId) throw new Error('Regeneration prompt must name the existing sceneId')
          reply = { tool: 'physics_generate_experiment', input: { sceneId } }
        } else {
          record.kind = 'parent-solve'
          reply = { tool: 'physics_solve_question', input: { text: CHAT_CODE_QUESTION } }
        }
      } else {
        record.kind = 'title'
        reply = { text: '竖直上抛代码实验' }
      }
      requests.push(record)
      await save()
      stream(response, { ...reply, id: `chat-code-${requests.length}` })
    })().catch(error => {
      // Test-provider diagnostics have no request headers, credentials or capability URLs.
      console.error('chat-code scripted provider:', error.message)
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error.message, code: 'SCRIPTED_PROVIDER_FAILED' } }))
    })
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  return { baseURL: `http://127.0.0.1:${server.address().port}`, requests, setMode: value => { mode = value; epoch += 1; epochChildren = 0 }, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mock = await startChatCodeMock({ port: Number(process.env.CHAT_CODE_MOCK_PORT ?? 8777), evidenceFile: process.env.CHAT_CODE_MOCK_EVIDENCE })
  console.log(JSON.stringify({ type: 'ready', base: mock.baseURL }))
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await mock.close(); process.exit(0) })
}
