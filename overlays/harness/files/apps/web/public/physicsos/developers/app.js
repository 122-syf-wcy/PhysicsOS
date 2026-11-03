import { documents, documentMarkdown } from './content.js'
import {
  STANDARD_VERSION,
  UPDATED_AT,
  agentInstructions,
  normalizeExperimentId,
} from './standards.js'

const main = document.querySelector('#main')
const nav = document.querySelector('#doc-nav')
const toc = document.querySelector('#toc-nav')
const search = document.querySelector('#doc-search')
const results = document.querySelector('#search-results')
const toast = document.querySelector('#toast')
let toastTimeout
let activeId = 'start'
let tocFrame
const mobileViewport = matchMedia('(max-width: 640px)')

// Descriptor availability only controls bound-prompt actions; ordinary docs initialize immediately.
let templateReleaseState = { status: 'loading', release: null }
let templateReleaseRequest
let authorTask = ''
const templateReleaseViews = new Map()

function observeTemplateRelease(node, update) {
  templateReleaseViews.set(node, update)
  update()
}
function notifyTemplateRelease() {
  for (const [node, update] of templateReleaseViews) {
    if (node.isConnected) update()
    else templateReleaseViews.delete(node)
  }
}
function loadTemplateRelease() {
  if (templateReleaseRequest) return templateReleaseRequest
  templateReleaseState = { status: 'loading', release: null }
  notifyTemplateRelease()
  templateReleaseRequest = Promise.resolve()
    .then(async () => {
      try {
        const response = await fetch(new URL('./downloads/template-release.json', import.meta.url))
        if (!response.ok) throw new Error('Template descriptor unavailable')
        const release = await response.json()
        if (release === null || typeof release !== 'object' || Array.isArray(release))
          throw new Error('Template descriptor must be an object')
        // Reuse the bound prompt's canonical descriptor checks; never invent an archive identity.
        agentInstructions('convex-lens', { release })
        templateReleaseState = { status: 'ready', release }
      } catch {
        templateReleaseState = { status: 'error', release: null }
      }
    })
    .finally(() => {
      templateReleaseRequest = undefined
      notifyTemplateRelease()
    })
  return templateReleaseRequest
}
function boundPromptText() {
  if (templateReleaseState.status !== 'ready') return null
  let text = agentInstructions('convex-lens', { release: templateReleaseState.release })
  if (authorTask.trim()) text += '\n## 本次用户任务\n\n' + authorTask.trim() + '\n'
  return text
}
function boundPromptButton(text, kind, className = 'button secondary') {
  const action = button(
    text,
    () => {
      const value = boundPromptText()
      if (value === null) return
      if (kind === 'copy') void copyText(value)
      else downloadText('AGENTS.md', value)
    },
    className,
  )
  action.dataset.boundPromptAction = kind
  observeTemplateRelease(action, () => {
    action.disabled = templateReleaseState.status !== 'ready'
  })
  return action
}
function templateReleaseNotice() {
  const notice = element('aside', 'note template-release-notice')
  const status = element('p')
  status.dataset.templateReleaseStatus = ''
  status.setAttribute('role', 'status')
  const retry = button('重试加载模板发布信息', () => {
    void loadTemplateRelease()
  })
  retry.dataset.templateReleaseRetry = ''
  observeTemplateRelease(notice, () => {
    const state = templateReleaseState.status
    status.textContent =
      state === 'ready'
        ? '可信模板发布信息已就绪。'
        : state === 'loading'
          ? '正在加载可信模板发布信息；文档可正常阅读。'
          : '可信模板发布信息加载失败；开发文档仍可阅读。请重试，加载成功后才能复制或下载绑定提示词。'
    retry.hidden = state === 'ready'
    retry.disabled = state !== 'error'
  })
  notice.append(status, retry)
  return notice
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function link(text, href, className) {
  const node = element('a', className, text)
  node.href = href
  return node
}

function showToast(message) {
  clearTimeout(toastTimeout)
  toast.textContent = message
  toast.hidden = false
  toastTimeout = setTimeout(() => {
    toast.hidden = true
  }, 2600)
}

async function copyText(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(text)
    showToast('已复制，可粘贴到编辑器')
  } catch {
    const dialog = document.querySelector('#copy-dialog')
    const field = document.querySelector('#copy-fallback')
    field.value = text
    if (!dialog.open) dialog.showModal()
    field.focus()
    field.select()
  }
}

function downloadText(filename, value) {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/markdown;charset=utf-8' }))
  const anchor = link('', url)
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function button(text, action, className = 'button secondary') {
  const node = element('button', className, text)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}

function codeBlock(title, language, value) {
  const box = element('div', 'code-block')
  const head = element('div', 'code-head')
  head.append(
    element('span', '', title),
    button(
      '复制',
      () => {
        void copyText(value)
      },
      'copy-button',
    ),
  )
  const pre = element('pre')
  pre.tabIndex = 0
  pre.setAttribute('aria-label', title)
  const code = element('code')
  code.dataset.language = language
  code.textContent = value
  pre.append(code)
  box.append(head, pre)
  return box
}

const downloadItems = [
  [
    'physicsos-experiment-template-v2.zip',
    '独立实验模板',
    '自己的目录开发 · 独立预览 · 生成投稿 ZIP',
    'ZIP',
  ],
  ['physicsos-code-style-v1.zip', '代码风格工具包', '完整规范 + AGENTS.md + 可执行检查配置', 'ZIP'],
  [
    'AGENTS.md',
    '凸透镜 V2 AGENTS.md',
    '绑定可信模板 URL 与 SHA-256；放入实验目录作为任务上下文',
    'MD',
  ],
  ['CODE_STYLE.md', '代码风格规范', '命名、类型、模块边界与格式规则', 'MD'],
  ['experiment.schema.json', '实验包 Schema', '凸透镜 V2 文件投稿 · 清单校验 Schema', 'JSON'],
  ['experiment.example.json', '清单示例', '候选结构 · 非完整可运行实验包', 'JSON'],
]

function downloadsBlock() {
  const container = element('div', 'download-list')
  for (const [file, title, description, format] of downloadItems) {
    const anchor = link('', `downloads/${file}`, 'download-item')
    anchor.download = file
    if (file === 'AGENTS.md') {
      anchor.dataset.boundPromptAction = 'download'
      anchor.addEventListener('click', (event) => {
        event.preventDefault()
        const value = boundPromptText()
        if (value !== null) downloadText(file, value)
      })
      observeTemplateRelease(anchor, () => {
        const ready = templateReleaseState.status === 'ready'
        anchor.setAttribute('aria-disabled', String(!ready))
        if (ready) anchor.href = `downloads/${file}`
        else anchor.removeAttribute('href')
        anchor.tabIndex = ready ? 0 : -1
      })
    }
    const text = element('div')
    text.append(element('strong', '', title), element('small', '', description))
    anchor.append(
      element('span', 'file-badge', format),
      text,
      element('span', 'download-arrow', '↓'),
    )
    container.append(anchor)
  }
  container.append(templateReleaseNotice())
  return container
}

function agentBlock() {
  const block = element('div', 'agent-builder')
  const form = element('form', 'agent-form')
  form.addEventListener('submit', (event) => {
    event.preventDefault()
  })
  const label = element('label', '', '已注册实验契约')
  label.htmlFor = 'experiment-id'
  const input = element('select')
  const option = element('option', '', '凸透镜 · convex-lens · V2')
  option.value = 'convex-lens'
  input.append(option)
  input.id = 'experiment-id'
  input.setAttribute('aria-describedby', 'id-help id-error')
  const help = element(
    'small',
    'input-help',
    '当前仅开放凸透镜 V2 契约；任务说明不会改变协议或元数据。',
  )
  help.id = 'id-help'
  const error = element('p', 'input-error')
  error.id = 'id-error'
  error.setAttribute('role', 'alert')
  const prompt = element('pre', 'agent-preview')
  prompt.tabIndex = 0
  prompt.setAttribute('aria-label', 'AGENTS.md 完整内容')
  const actions = element('div', 'agent-actions')
  let current = ''
  const copy = boundPromptButton('复制 AGENTS.md', 'copy', 'button primary')
  const download = boundPromptButton('下载 AGENTS.md', 'download')
  actions.append(
    copy,
    download,
    element('span', 'agent-meta', `规范 v${STANDARD_VERSION} · 完整规则`),
  )
  const taskLabel = element('label', '', '本次任务说明（可选）')
  taskLabel.htmlFor = 'task-description'
  const task = element('textarea')
  task.id = 'task-description'
  task.maxLength = 2000
  task.value = authorTask
  task.placeholder = '例如：改进器材材质和手机拖动体验'
  function updatePrompt() {
    try {
      const id = normalizeExperimentId(input.value)
      current =
        templateReleaseState.status === 'ready'
          ? agentInstructions(id, { release: templateReleaseState.release })
          : agentInstructions(id, { baseOnly: true })
      if (task.value.trim()) current += '\n## 本次用户任务\n\n' + task.value.trim() + '\n'
      prompt.textContent = current
      error.textContent = ''
      input.setAttribute('aria-invalid', 'false')
      copy.disabled = templateReleaseState.status !== 'ready'
      download.disabled = templateReleaseState.status !== 'ready'
    } catch (issue) {
      error.textContent = issue.message
      input.setAttribute('aria-invalid', 'true')
      copy.disabled = true
      download.disabled = true
    }
  }
  input.addEventListener('change', updatePrompt)
  task.addEventListener('input', () => {
    authorTask = task.value
    updatePrompt()
  })
  observeTemplateRelease(block, updatePrompt)
  form.append(label, input, help, taskLabel, task, error)
  block.append(form, templateReleaseNotice(), actions, prompt)
  return block
}

function renderBlock(block) {
  if (block.type === 'paragraph') return element('p', '', block.text)
  if (block.type === 'note') {
    const note = element('aside', 'note')
    note.append(element('strong', '', block.title), element('p', '', block.text))
    return note
  }
  if (block.type === 'list') {
    const list = element('ul', 'content-list')
    for (const text of block.items) list.append(element('li', '', text))
    return list
  }
  if (block.type === 'code') return codeBlock(block.title, block.language, block.value)
  if (block.type === 'table') {
    const wrapper = element('div', 'table-wrap')
    wrapper.tabIndex = 0
    wrapper.setAttribute('aria-label', block.headers.join('、'))
    const table = element('table')
    const head = element('thead')
    const headRow = element('tr')
    for (const text of block.headers) {
      const cell = element('th', '', text)
      cell.scope = 'col'
      headRow.append(cell)
    }
    head.append(headRow)
    const body = element('tbody')
    for (const row of block.rows) {
      const tr = element('tr')
      for (const text of row) tr.append(element('td', '', text))
      body.append(tr)
    }
    table.append(head, body)
    wrapper.append(table)
    return wrapper
  }
  if (block.type === 'agent') return agentBlock()
  if (block.type === 'downloads') return downloadsBlock()
  return element('div')
}

function hero() {
  const container = element('div', 'hero')
  const top = element('div', 'hero-eyebrow')
  top.append(
    element('span', 'small-dot'),
    element('span', '', 'PHYSICSOS · OPEN EXPERIMENTS'),
    element('span', 'version-pill', `规范 v${STANDARD_VERSION}`),
  )
  const heading = element('h1')
  heading.append(
    document.createTextNode('一起，把物理'),
    element('br'),
    element('em', '', '做成看得见的实验。'),
  )
  const subtitle = element(
    'p',
    'hero-description',
    '下载模板，独立制作实验文件，上传并审核。\n无需修改主站源码，让你的作品成为实验的一部分。',
  )
  const actions = element('div', 'hero-actions')
  actions.append(
    boundPromptButton('复制 AGENTS.md  ↗', 'copy', 'button primary'),
    link('阅读代码规范  →', '#/code-style', 'button secondary'),
  )
  const quick = element('div', 'quick-cards')
  for (const [id, number, title, desc] of [
    ['downloads', '01', '下载独立模板', '不克隆主站，自己的目录开发'],
    ['agents', '02', '按标准制作文件', '复制 AGENTS.md，统一代码与效果'],
    ['review', '03', '上传后审核同步', '最新通过版本成为默认效果'],
  ]) {
    const card = link('', `#/${id}`, 'quick-card')
    card.append(
      element('span', 'card-number', number),
      element('strong', '', title),
      element('small', '', desc),
      element('span', 'card-arrow', '↗'),
    )
    quick.append(card)
  }
  const preview = element('div', 'hero-code')
  const tab = element('div', 'hero-code-head')
  tab.append(
    element('span', 'file-tab', 'AGENTS.md'),
    element('span', '', '独立制作文件，审核后同步展示'),
  )
  const lines = element('div', 'hero-code-lines')
  const content = [
    '# PhysicsOS 实验开发约定',
    '',
    '01  只开发独立实验文件包',
    '02  引擎决定物理，三维负责呈现',
    '03  同一套交互与 Warm Lab 视觉',
    '04  打包上传，审核后同步展示',
  ]
  content.forEach((text, index) => {
    const line = element('div')
    line.append(
      element('span', 'line-number', String(index + 1).padStart(2, '0')),
      element('span', index === 0 ? 'code-title' : '', text),
    )
    lines.append(line)
  })
  const footer = element('div', 'hero-code-foot')
  footer.append(
    element('span', 'check-dot', '✓'),
    element('span', '', 'TypeScript · Three.js · 实验文件 ZIP'),
    link('查看完整提示词 →', '#/agents'),
  )
  preview.append(tab, lines, footer)
  const intro = element('div', 'hero-intro')
  const copy = element('div', 'hero-copy')
  copy.append(heading, subtitle, actions, templateReleaseNotice())
  const art = element('figure', 'hero-mascot')
  const picture = element('picture')
  const image = element('img')
  image.src = 'assets/mascot-developer-640.webp'
  image.srcset = 'assets/mascot-developer-320.webp 320w, assets/mascot-developer-640.webp 640w'
  image.sizes = '(max-width: 640px) 210px, 280px'
  image.width = 640
  image.height = 640
  image.alt = 'PhysicsOS 小 Q 和小猫在实验桌边一起开发物理实验'
  image.decoding = 'async'
  picture.append(image)
  art.append(picture)
  intro.append(copy, art)
  container.append(top, intro, quick, preview)
  return container
}

function renderNav() {
  let group
  for (const doc of documents) {
    if (doc.group !== group) {
      group = doc.group
      nav.append(element('div', 'nav-group', group))
    }
    const anchor = link(doc.title, `#/${doc.id}`, 'nav-link')
    anchor.dataset.doc = doc.id
    if (doc.id === 'agents') anchor.append(element('span', 'nav-badge', '复制'))
    nav.append(anchor)
  }
}

function parseRoute() {
  const hash = location.hash
  if (hash === '#main') return { id: activeId }
  const match = /^#\/([a-z-]+)(?:\/([a-z-]+))?$/.exec(hash)
  if (!hash || hash === '#/') return { id: 'start' }
  return match ? { id: match[1], section: match[2] } : { id: 'not-found' }
}

function closeMenu() {
  if (document.querySelector('#sidebar').contains(document.activeElement)) {
    document.querySelector('#menu-toggle').focus({ preventScroll: true })
  }
  document.body.classList.remove('menu-open')
  document.querySelector('#menu-toggle').setAttribute('aria-expanded', 'false')
  document.querySelector('#menu-backdrop').hidden = true
  document.querySelector('#sidebar').inert = mobileViewport.matches
}

function renderPage() {
  const route = parseRoute()
  const doc = documents.find((item) => item.id === route.id)
  closeMenu()
  results.hidden = true
  if (!doc) {
    delete main.dataset.doc
    document
      .querySelectorAll('[data-doc]')
      .forEach((anchor) => anchor.removeAttribute('aria-current'))
    main.replaceChildren(
      element('div', 'breadcrumb', '文档 / 未找到页面'),
      element('h1', 'not-found-title', '这份文档还没有写在这里。'),
      element('p', '', '链接可能已经变更，可以返回目录或搜索关键词。'),
      link('返回文档首页 →', '#/start', 'button primary'),
    )
    toc.replaceChildren()
    document.title = '文档未找到 · PhysicsOS'
    return
  }
  const samePage = activeId === doc.id && main.dataset.doc === doc.id
  activeId = doc.id
  document.querySelectorAll('[data-doc]').forEach((anchor) => {
    if (anchor.dataset.doc === doc.id) anchor.setAttribute('aria-current', 'page')
    else anchor.removeAttribute('aria-current')
  })
  if (samePage) {
    if (route.section) document.getElementById(route.section)?.scrollIntoView()
    else window.scrollTo(0, 0)
    requestAnimationFrame(updateToc)
    return
  }
  main.dataset.doc = doc.id
  document.title = `${doc.title} · PhysicsOS 开发者文档`
  templateReleaseViews.clear()
  main.replaceChildren()
  const crumbs = element('div', 'breadcrumb')
  crumbs.append(
    link('开发者文档', '#/start'),
    element('span', '', '/'),
    element('span', '', doc.title),
  )
  main.append(crumbs)
  if (doc.id === 'start') main.append(hero())
  else {
    const header = element('header', 'doc-header')
    header.append(
      element('span', 'doc-tag', doc.tag),
      element('h1', '', doc.title),
      element('p', '', doc.subtitle),
    )
    const actions = element('div', 'doc-actions')
    actions.append(
      button(
        '复制本文链接',
        () => {
          const url = new URL(location.href)
          url.hash = `/${doc.id}`
          void copyText(url.toString())
        },
        'text-button',
      ),
      doc.id === 'agents'
        ? boundPromptButton('下载 AGENTS.md ↓', 'download', 'text-button')
        : link('下载 Markdown ↓', `downloads/${doc.file}`, 'text-link'),
    )
    if (doc.id !== 'agents') actions.lastChild.download = doc.file
    header.append(actions)
    main.append(header)
  }
  const article = element('article', 'article')
  toc.replaceChildren()
  for (const section of doc.sections) {
    const item = element('section', 'doc-section')
    item.id = section.id
    const heading = element('h2')
    const anchor = link(section.title, `#/${doc.id}/${section.id}`)
    heading.append(anchor)
    item.append(heading)
    for (const block of section.blocks) item.append(renderBlock(block))
    article.append(item)
    toc.append(link(section.title, `#/${doc.id}/${section.id}`, 'toc-link'))
  }
  main.append(article)
  const index = documents.indexOf(doc)
  const pager = element('nav', 'pager')
  pager.setAttribute('aria-label', '相邻文档')
  for (const [label, next] of [
    ['← 上一篇', documents[index - 1]],
    ['下一篇 →', documents[index + 1]],
  ]) {
    if (!next) {
      pager.append(element('span'))
      continue
    }
    const anchor = link('', `#/${next.id}`)
    anchor.append(element('small', '', label), element('strong', '', next.title))
    pager.append(anchor)
  }
  main.append(
    pager,
    element(
      'footer',
      'doc-footer',
      `PhysicsOS · 开源实验，共同维护　 /　规范 ${STANDARD_VERSION} · ${UPDATED_AT}`,
    ),
  )
  if (route.section)
    requestAnimationFrame(() => {
      document.getElementById(route.section)?.scrollIntoView()
      updateToc()
    })
  else {
    window.scrollTo(0, 0)
    requestAnimationFrame(updateToc)
  }
}

function updateToc() {
  const sections = [...main.querySelectorAll('.doc-section')]
  let current = sections[0]
  const threshold = mobileViewport.matches ? 150 : 120
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= threshold) current = section
  }
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 5) {
    current = sections.at(-1)
  }
  if (!current) return
  toc.querySelectorAll('a').forEach((anchor) => {
    const selected = anchor.hash.endsWith('/' + current.id)
    anchor.classList.toggle('current', selected)
    if (selected) anchor.setAttribute('aria-current', 'location')
    else anchor.removeAttribute('aria-current')
  })
}

window.addEventListener(
  'scroll',
  () => {
    if (tocFrame !== undefined) return
    tocFrame = requestAnimationFrame(() => {
      tocFrame = undefined
      updateToc()
    })
  },
  { passive: true },
)

function searchDocuments() {
  const query = search.value.trim().toLowerCase()
  results.replaceChildren()
  if (!query) {
    results.hidden = true
    return
  }
  const matches = []
  for (const doc of documents) {
    if (`${doc.title} ${doc.subtitle}`.toLowerCase().includes(query)) {
      matches.push({ title: doc.title, path: `#/${doc.id}`, description: doc.subtitle })
    }
    for (const section of doc.sections) {
      const body = section.blocks
        .map(
          (block) =>
            block.text ??
            block.value ??
            block.items?.join(' ') ??
            block.rows?.flat().join(' ') ??
            '',
        )
        .join(' ')
      if (`${section.title} ${body}`.toLowerCase().includes(query))
        matches.push({
          title: `${doc.title} / ${section.title}`,
          path: `#/${doc.id}/${section.id}`,
          description: body.slice(0, 90),
        })
    }
  }
  results.hidden = false
  const summary = element(
    'div',
    'search-summary',
    matches.length
      ? `找到 ${matches.length} 处内容`
      : '没有找到相关内容，试试“命名”“拖动”或“作者”。',
  )
  summary.setAttribute('role', 'status')
  results.append(summary)
  for (const match of matches.slice(0, 8)) {
    const anchor = link('', match.path, 'search-result')
    anchor.append(element('strong', '', match.title), element('small', '', match.description))
    anchor.addEventListener('click', () => {
      results.hidden = true
      search.value = ''
      main.focus({ preventScroll: true })
    })
    results.append(anchor)
  }
}

renderNav()
renderPage()
void loadTemplateRelease()
window.addEventListener('hashchange', renderPage)
search.addEventListener('input', searchDocuments)
search.addEventListener('focus', () => {
  if (search.value) searchDocuments()
})
search.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'Enter') {
    const first = results.querySelector('a')
    if (first) {
      event.preventDefault()
      first.focus()
    }
  }
  if (event.key === 'Escape') results.hidden = true
})
document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-wrap')) results.hidden = true
})
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    search.focus()
    search.select()
  }
  if (event.key === 'Escape') {
    results.hidden = true
    closeMenu()
  }
})
document.querySelector('#menu-toggle').addEventListener('click', () => {
  const open = !document.body.classList.contains('menu-open')
  document.body.classList.toggle('menu-open', open)
  document.querySelector('#menu-toggle').setAttribute('aria-expanded', String(open))
  document.querySelector('#menu-backdrop').hidden = !open
  document.querySelector('#sidebar').inert = mobileViewport.matches && !open
})
document.querySelector('#menu-backdrop').addEventListener('click', closeMenu)
document.querySelector('#close-copy').addEventListener('click', () => {
  document.querySelector('#copy-dialog').close()
})

mobileViewport.addEventListener('change', closeMenu)
closeMenu()
