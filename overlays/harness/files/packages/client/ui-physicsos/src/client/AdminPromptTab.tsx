/** Editable Markdown stays separate from the platform's frozen compatibility contract. */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  AdminCard,
  AdminCardHead,
  AdminCardTitle,
  AdminCardMeta,
  AdminEmpty,
} from './AdminPrimitives.tsx'
import type { DeveloperPromptApi, PromptAdminView, PromptVersion } from './developer-prompt-api.ts'
import {
  renderPrompt,
  validateBody,
  PROMPT_VERSION,
  PROMPT_IMPORT_LIMIT,
} from './developer-prompt-format.ts'
import { contributionFileData } from './experiments/contribution-api.ts'
import css from './AdminWorkspace.module.css'
import styles from './AdminPromptTab.module.css'

type Form = { version: string; body: string; note: string }
const nextVersion = (version: string): string => {
  const parts = version.split('.')
  parts[2] = (BigInt(parts[2] ?? '0') + 1n).toString()
  return parts.join('.').length <= 32 ? parts.join('.') : ''
}
const fromView = (view: PromptAdminView): Form =>
  view.draft
    ? { version: view.draft.version, body: view.draft.body, note: view.draft.note }
    : {
      version: view.current.id === 'system-default' ? '1.0.0' : nextVersion(view.current.version),
      body: view.current.body,
      note: '',
    }
const message = (error: unknown): string =>
  error instanceof Error ? error.message : '操作失败，请稍后重试。'

export function AdminPromptTab({ api }: { api: DeveloperPromptApi }): ReactNode {
  const [view, setView] = useState<PromptAdminView>()
  const [form, setForm] = useState<Form>({ version: '', body: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const epoch = useRef(0)
  const request = useRef(0)
  const live = useRef(true)
  const hasForm = useRef(false)
  const locked = useRef(false)

  const edit = (patch: Partial<Form>): void => {
    epoch.current++
    setForm(value => ({ ...value, ...patch }))
    setNotice('')
  }
  const receive = useCallback(
    (result: PromptAdminView, startedAt: number, replace: boolean): void => {
      setView(result)
      if ((!hasForm.current || replace) && epoch.current === startedAt) {
        setForm(fromView(result))
        hasForm.current = true
      }
    },
    [],
  )
  const refresh = useCallback(async (): Promise<void> => {
    if (locked.current) return
    const token = ++request.current,
      startedAt = epoch.current
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api.get()
      if (live.current && request.current === token) receive(result, startedAt, false)
    } catch (cause) {
      if (live.current && request.current === token) setError(message(cause))
    } finally {
      if (live.current && request.current === token) {
        locked.current = false
        setBusy(false)
      }
    }
  }, [api, receive])
  useEffect(() => {
    live.current = true
    void refresh()
    return () => {
      live.current = false
      request.current++
      locked.current = false
    }
  }, [refresh])

  const run = async (
    operation: () => Promise<PromptAdminView>,
    success: string,
    replace = true,
  ): Promise<void> => {
    if (locked.current) return
    const token = ++request.current,
      startedAt = epoch.current
    locked.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await operation()
      if (live.current && request.current === token) {
        receive(result, startedAt, replace)
        setNotice(epoch.current === startedAt ? success : `${success} 当前未保存的编辑已保留。`)
      }
    } catch (cause) {
      if (live.current && request.current === token) setError(message(cause))
    } finally {
      if (live.current && request.current === token) {
        locked.current = false
        setBusy(false)
      }
    }
  }
  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !view) return
    if (
      !/\.(md|markdown)$/i.test(file.name) ||
      file.size === 0 ||
      file.size > PROMPT_IMPORT_LIMIT
    ) {
      setError('请选择不超过 128 KiB 的 .md 或 .markdown 文件。')
      return
    }
    if (!PROMPT_VERSION.test(form.version) || form.version.length > 32) {
      setError('请先填写有效提示词版本，例如 1.1.0。')
      return
    }
    void run(async () => {
      const data = await contributionFileData(file, PROMPT_IMPORT_LIMIT)
      return api.import({
        expectedRevision: view.revision,
        version: form.version,
        note: form.note,
        filename: file.name,
        base64: data.slice(data.indexOf(',') + 1),
      })
    }, 'Markdown 已导入草稿，可继续编辑；尚未发布。')
  }

  let validation = '',
    preview = ''
  if (view) {
    try {
      if (!PROMPT_VERSION.test(form.version) || form.version.length > 32)
        throw new Error('版本使用 X.Y.Z 格式，例如 1.1.0。')
      validateBody(form.body)
      if (form.note.length > 500) throw new Error('修改说明最多 500 字。')
      preview = renderPrompt(
        { version: form.version, body: form.body, binding: view.seed.binding },
        location.origin,
      )
    } catch (cause) {
      validation = message(cause)
    }
  }
  const dirty =
    !view?.draft ||
    view.draft.version !== form.version ||
    view.draft.body !== form.body ||
    view.draft.note !== form.note
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(preview)
      setNotice('完整提示词已复制。')
    } catch {
      setError('浏览器无法复制，请下载 Markdown 文件。')
    }
  }
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([preview], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `physicsos-convex-lens-prompt-${form.version}.md`
    anchor.click()
    setTimeout(() =>{  URL.revokeObjectURL(url); }, 1000)
  }
  const useVersion = (item: PromptVersion): void => {
    edit({ body: item.body, note: '', version: nextVersion(item.version) })
    setError('')
  }

  return (
    <div className={styles.root} data-prompt-management="">
      <AdminCard>
        <AdminCardHead>
          <div>
            <AdminCardTitle>开发提示词</AdminCardTitle>
            <AdminCardMeta>凸透镜实验 · 保存草稿后手动发布 · 已发布版本可回滚</AdminCardMeta>
          </div>
          <button
            type="button"
            className={css.ghost}
            disabled={busy}
            onClick={() => {
              void refresh()
            }}
          >
            刷新服务器版本
          </button>
        </AdminCardHead>
        {view && (
          <p data-testid="prompt-current">
            当前生效：{view.current.publishedAt === null ? '系统默认' : `v${view.current.version}`}{' '}
            · 固定实验格式 V2
          </p>
        )}
        {view && <a href="/physicsos/developer-prompts/current.md">下载当前已发布提示词</a>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {!view && <AdminEmpty>{busy ? '正在加载提示词…' : '请重新加载提示词管理。'}</AdminEmpty>}
      </AdminCard>
      {view && (
        <>
          <div className={styles.columns}>
            <AdminCard>
              <AdminCardTitle>提示词草稿</AdminCardTitle>
              <p className={styles.hint}>
                编辑开发说明。实验协议、模板摘要和发布要求由系统补入完整预览。导入完整导出文件时只读取可编辑正文。
              </p>
              <div className={styles.fields}>
                <label className={css.field}>
                  <span>提示词版本</span>
                  <input
                    className={css.input}
                    value={form.version}
                    maxLength={32}
                    onChange={event =>{  edit({ version: event.target.value }); }}
                  />
                </label>
                <label className={css.field}>
                  <span>修改说明</span>
                  <input
                    className={css.input}
                    value={form.note}
                    maxLength={500}
                    onChange={event =>{  edit({ note: event.target.value }); }}
                  />
                </label>
                <label className={css.field}>
                  <span>Markdown 正文</span>
                  <textarea
                    className={`${css.input} ${styles.editor}`}
                    value={form.body}
                    onChange={event =>{  edit({ body: event.target.value }); }}
                    spellCheck={false}
                  />
                </label>
                <label className={styles.upload}>
                  <span>导入 Markdown</span>
                  <input
                    type="file"
                    accept=".md,.markdown,text/markdown"
                    disabled={busy}
                    onChange={upload}
                  />
                </label>
                <p className={styles.hint}>
                  正文最多 64 KiB，导入文件最多 128 KiB。提示词版本独立于实验包版本。
                </p>
              </div>
              {validation && <p className={styles.error}>{validation}</p>}
              {view.bindingChanged && (
                <p className={styles.error}>模板或固定规范已更新，请重新保存并核对预览后发布。</p>
              )}
              <div className={`${css.actions} ${styles.actions}`}>
                <button
                  type="button"
                  className={css.ghost}
                  disabled={busy || !!validation || (!dirty && !view.bindingChanged)}
                  onClick={() => {
                    void run(
                      () => api.save({ ...form, expectedRevision: view.revision }),
                      '草稿已保存，开发者仍使用当前发布版。',
                    )
                  }}
                >
                  保存草稿
                </button>
                <button
                  type="button"
                  className={css.primary}
                  disabled={busy || !!validation || dirty || !view.draft || view.bindingChanged}
                  onClick={() => {
                    void run(
                      () => api.publish({ expectedRevision: view.revision }),
                      '提示词已发布，开发者重新加载后获取此版本。',
                    )
                  }}
                >
                  发布当前草稿
                </button>
              </div>
            </AdminCard>
            <AdminCard>
              <AdminCardTitle>完整提示词预览</AdminCardTitle>
              <p className={styles.hint}>
                下方内容与复制、下载一致；未保存的编辑不会影响当前发布版。
              </p>
              <div className={`${css.actions} ${styles.actions}`}>
                <button
                  type="button"
                  className={css.ghost}
                  disabled={!preview}
                  onClick={() => {
                    void copy()
                  }}
                >
                  复制完整提示词
                </button>
                <button type="button" className={css.ghost} disabled={!preview} onClick={download}>
                  下载 Markdown
                </button>
              </div>
              <pre className={styles.preview} aria-label="完整提示词预览">
                {preview || '填写有效版本和正文后显示完整提示词。'}
              </pre>
            </AdminCard>
          </div>
          <AdminCard>
            <AdminCardTitle>发布历史</AdminCardTitle>
            {view.versions.length === 0 ? (
              <AdminEmpty>尚无后台发布记录，当前使用系统默认提示词。</AdminEmpty>
            ) : (
              <div className={styles.history}>
                {[...view.versions].reverse().map(item => (
                  <article key={item.id}>
                    <div>
                      <strong>
                        v{item.version}
                        {view.current.id === item.id ? ' · 当前生效' : ''}
                      </strong>
                      <p>{item.note || '未填写修改说明'}</p>
                      <small>
                        {item.publishedAt ? new Date(item.publishedAt).toLocaleString() : ''} ·{' '}
                        {item.publishedBy}
                      </small>
                      <p className={styles.digest}>SHA-256 {item.sha256}</p>
                    </div>
                    <div className={`${css.actions} ${styles.actions}`}>
                      <a href={`/physicsos/developer-prompts/versions/${item.id}.md`}>下载此版本</a>
                      <button
                        type="button"
                        className={css.ghost}
                        disabled={busy}
                        onClick={() =>{  useVersion(item); }}
                        aria-label={`从 ${item.version} 继续编辑`}
                      >
                        继续编辑新版本
                      </button>
                      <button
                        type="button"
                        className={css.ghost}
                        disabled={busy || view.current.id === item.id}
                        onClick={() => {
                          void run(
                            () =>
                              api.activate({
                                expectedRevision: view.revision,
                                id: item.id,
                                expectedSha256: item.sha256,
                              }),
                            `已切换到提示词 v${item.version}，历史记录保留。`,
                            false,
                          )
                        }}
                      >
                        设为当前
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </AdminCard>
        </>
      )}
    </div>
  )
}
