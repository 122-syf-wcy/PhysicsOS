import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ModerationApiError, moderationStatuses,
  type ModerationApi, type ModerationCase, type ModerationPage, type ModerationQuery,
  type ModerationSettings, type ModerationStatus,
} from './moderation-api.ts'
import {
  AdminCard, AdminCardActions, AdminCardHead, AdminCardMeta, AdminCardTitle,
  AdminEmpty, AdminStats, AdminTable, AdminToolbar,
} from './AdminPrimitives.tsx'
import css from './AdminModerationTab.module.css'

const labels: Record<ModerationStatus, string> = {
  pending: '等待审查', reviewing: 'AI 审查中', allowed: 'AI 建议允许', flagged: '建议人工复核',
  error: '审查失败', dismissed: '已驳回', banned: '已封禁',
}
const categories = {
  none: '无风险', illegal_assistance: '违法协助', abuse: '辱骂', self_harm: '自伤风险',
  sexual: '性内容', violence: '暴力', privacy: '隐私', other: '其他',
}
const severity = { none: '无', low: '低', medium: '中', high: '高' }
const time = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}
const message = (error: unknown): string => error instanceof ModerationApiError
  ? `${error.message}（${error.code}，HTTP ${error.status}）`
  : error instanceof Error ? error.message : '请求失败，请重试。'
type Slot = 'list' | 'settings' | 'detail'
type Confirmation = { id: string; version: number; reason: string }

/** AI evidence remains literal text. Decisions always target the server-owned case. */
export function AdminModerationTab({ api }: { api: ModerationApi }) {
  const [query, setQuery] = useState<ModerationQuery>({ page: 1, limit: 20 })
  const [page, setPage] = useState<ModerationPage>()
  const [settings, setSettings] = useState<ModerationSettings>()
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<ModerationCase>()
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [errors, setErrors] = useState<Partial<Record<Slot | 'action', string | undefined>>>({})
  const [busy, setBusy] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [scanResult, setScanResult] = useState('')
  const live = useRef(true)
  const selectedRef = useRef<string>()
  const detailRef = useRef<ModerationCase>()
  const settingsRef = useRef<ModerationSettings>()
  const reads = useRef<Partial<Record<Slot, AbortController>>>({})
  const requests = useRef(new Set<AbortController>())
  const actionInFlight = useRef(false)

  const start = useCallback((slot?: Slot) => {
    if (slot !== undefined) reads.current[slot]?.abort()
    const controller = new AbortController()
    requests.current.add(controller)
    if (slot !== undefined) reads.current[slot] = controller
    return controller
  }, [])
  const current = (controller: AbortController) => live.current && !controller.signal.aborted
  const setError = useCallback((slot: Slot | 'action', value?: string) => {
    setErrors(old => ({ ...old, [slot]: value }))
  }, [])
  const applyDetail = useCallback((value: ModerationCase) => {
    if (selectedRef.current !== value.id) return
    const previous = detailRef.current
    if (previous?.id === value.id && previous.version > value.version) return
    if (previous?.version !== value.version || value.decision !== undefined) setConfirmation(undefined)
    detailRef.current = value
    setDetail(value)
  }, [])
  const applySettings = useCallback((value: ModerationSettings) => {
    if (settingsRef.current && settingsRef.current.version > value.version) return
    settingsRef.current = value
    setSettings(value)
  }, [])
  const loadList = useCallback(async () => {
    const controller = start('list')
    try {
      const value = await api.list(query, controller.signal)
      if (!current(controller)) return
      setPage(value)
      setError('list')
    } catch (error) {
      if (current(controller)) setError('list', `列表：${message(error)}`)
    } finally {
      requests.current.delete(controller)
      if (current(controller)) setListLoading(false)
    }
  }, [api, query, setError, start])
  const loadSettings = useCallback(async () => {
    const controller = start('settings')
    try {
      const value = await api.settings(controller.signal)
      if (!current(controller)) return
      applySettings(value)
      setError('settings')
    } catch (error) {
      if (current(controller)) setError('settings', `自动审查：${message(error)}`)
    } finally { requests.current.delete(controller) }
  }, [api, applySettings, setError, start])
  const loadDetail = useCallback(async (id: string) => {
    const controller = start('detail')
    try {
      const value = await api.detail(id, controller.signal)
      if (!current(controller) || selectedRef.current !== id) return
      if (value.id !== id) throw new ModerationApiError(502, 'INVALID_RESPONSE', '返回的记录与选中记录不一致')
      applyDetail(value)
      setError('detail')
    } catch (error) {
      if (current(controller) && selectedRef.current === id) setError('detail', `详情：${message(error)}`)
    } finally { requests.current.delete(controller) }
  }, [api, applyDetail, setError, start])

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      for (const controller of requests.current) controller.abort()
      for (const controller of Object.values(reads.current)) controller.abort()
      requests.current.clear()
    }
  }, [api])
  useEffect(() => {
    setListLoading(true)
    setPage(undefined)
    void loadList()
    return () => { reads.current.list?.abort() }
  }, [loadList])
  useEffect(() => { void loadSettings() }, [loadSettings])
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState !== 'visible' || actionInFlight.current) return
      void loadList()
      void loadSettings()
      if (selectedRef.current !== undefined) void loadDetail(selectedRef.current)
    }
    const timer = setInterval(refreshVisible, 10_000)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [loadDetail, loadList, loadSettings])

  const choose = (id: string) => {
    if (actionInFlight.current) return
    selectedRef.current = id
    detailRef.current = undefined
    setSelected(id)
    setDetail(undefined)
    setReason('')
    setConfirmation(undefined)
    setError('detail')
    setError('action')
    void loadDetail(id)
  }
  const changeQuery = (next: ModerationQuery) => {
    reads.current.detail?.abort()
    selectedRef.current = undefined
    detailRef.current = undefined
    setSelected(undefined)
    setDetail(undefined)
    setReason('')
    setConfirmation(undefined)
    setError('detail')
    setQuery(next)
  }
  const refresh = async () => {
    await Promise.all([loadList(), loadSettings(),
      selectedRef.current === undefined ? Promise.resolve() : loadDetail(selectedRef.current)])
  }
  const mutate = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setBusy(true)
    setError('action')
    const controller = start()
    // Read responses started before a human action must never undo its result.
    for (const read of Object.values(reads.current)) read.abort()
    try {
      await operation(controller.signal)
    } catch (error) {
      if (current(controller)) setError('action', message(error))
    } finally {
      if (current(controller)) {
        setConfirmation(undefined)
        await refresh()
      }
      requests.current.delete(controller)
      actionInFlight.current = false
      if (current(controller)) setBusy(false)
    }
  }
  const decide = (decision: 'dismiss' | 'ban', confirmed?: Confirmation) => {
    const target = detailRef.current, explanation = reason.trim()
    if (!target || target.decision || explanation.length === 0 || explanation.length > 2_000) return
    if (decision === 'ban' && (confirmed?.id !== target.id || confirmed.version !== target.version || confirmed.reason !== explanation)) {
      setConfirmation(undefined)
      setError('action', '记录或理由已更新，请重新确认封禁。')
      return
    }
    void mutate(async (signal) => {
      const result = await api.decide(target.id, { version: target.version, decision, reason: explanation }, signal)
      if (!signal.aborted && live.current) applyDetail(result)
    })
  }
  const canDecide = detail !== undefined && detail.decision === undefined && !busy
    && reason.trim().length > 0 && reason.trim().length <= 2_000
  const canRetry = detail !== undefined && detail.decision === undefined
    && !['pending', 'reviewing'].includes(detail.status) && !busy
  const errorMessages = Object.values(errors).filter((value): value is string => value !== undefined)
  const pages = page ? Math.max(1, Math.ceil(page.total / page.limit)) : 1

  return <div className={css.root} data-testid="moderation-page">
    <AdminCard>
      <AdminCardHead>
        <div><AdminCardTitle as="h2">对话审核</AdminCardTitle>
          <AdminCardMeta>AI 仅提供建议，人工核对原文与上下文后作出决定。页面可见时每 10 秒刷新。</AdminCardMeta></div>
        <AdminCardActions><button type="button" disabled={busy} onClick={() => { void refresh() }}>刷新审核记录</button></AdminCardActions>
      </AdminCardHead>
      <AdminStats items={[
        { key: 'total', value: page?.total ?? '—', label: query.status ? '条筛选记录' : '条审核记录' },
        { key: 'enabled', value: settings === undefined ? '加载中' : settings.enabled ? '已启用' : '已暂停', label: '自动审查' },
      ]} />
      <AdminToolbar>
        <button type="button" disabled={busy || settings === undefined} onClick={() => {
          const value = settingsRef.current
          if (!value) return
          void mutate(async (signal) => {
            const result = await api.setEnabled({ version: value.version, enabled: !value.enabled }, signal)
            if (!signal.aborted && live.current) applySettings(result)
          })
        }}>{settings?.enabled === false ? '启用自动审查' : '暂停自动审查'}</button>
        <button type="button" disabled={busy} onClick={() => {
          setScanResult('')
          void mutate(async (signal) => {
            const result = await api.scan(signal)
            if (!signal.aborted && live.current) setScanResult(`本次扫描 ${result.scanned} 条，新增记录 ${result.captured} 条。`)
          })
        }}>补扫历史（最多 20 条）</button>
      </AdminToolbar>
      {settings !== undefined && <p className={settings.captureFailures > 0 ? css.warning : css.meta}>
        接收失败累计：{settings.captureFailures}{settings.lastCaptureFailure ? ` · ${settings.lastCaptureFailure}：存储容量已满，需管理员处理。` : ''}
      </p>}
      <p className={css.meta}>暂停自动审查会停止 AI 审查；已保存的记录仍可人工复核。历史补扫每次最多 20 条。</p>
      {scanResult && <p role="status">{scanResult}</p>}
    </AdminCard>
    {errorMessages.length > 0 && <div className={css.error} role="alert">{errorMessages.map((error, index) => <p key={index}>{error}</p>)}</div>}
    <div className={css.columns}>
      <AdminCard>
        <AdminCardHead><AdminCardTitle>审核记录</AdminCardTitle></AdminCardHead>
        <AdminToolbar><label className={css.field}>审核状态
          <select aria-label="审核状态" value={query.status ?? ''} disabled={busy} onChange={(event) => {
            const status = event.target.value as ModerationStatus | ''
            changeQuery({ page: 1, limit: 20, ...(status === '' ? {} : { status }) })
          }}><option value="">全部状态</option>{moderationStatuses.map(status => <option key={status} value={status}>{labels[status]}</option>)}</select>
        </label></AdminToolbar>
        {listLoading ? <AdminEmpty>正在加载审核记录…</AdminEmpty>
          : page?.cases.length === 0 ? <AdminEmpty>没有符合条件的记录。</AdminEmpty>
            : page && <AdminTable>
              <thead><tr><th>账号 / 学校</th><th>状态 / 时间</th><th>查看</th></tr></thead>
              <tbody>{page.cases.map(row => <tr key={row.id} className={selected === row.id ? css.selected : undefined}>
                <td><strong>{row.username}</strong><div className={css.meta}>{row.schoolId} · {row.accountStatus === 'disabled' ? '已停用' : '正常'}</div></td>
                <td>{labels[row.status]}<div className={css.meta}>{time(row.createdAt)}</div></td>
                <td><button type="button" disabled={busy} aria-label={`查看 ${row.id}`} onClick={() => { choose(row.id) }}>查看</button></td>
              </tr>)}</tbody>
            </AdminTable>}
        <AdminToolbar>
          <button type="button" disabled={busy || listLoading || (query.page ?? 1) <= 1} onClick={() => { changeQuery({ ...query, page: (query.page ?? 1) - 1 }) }}>上一页</button>
          <span className={css.meta}>第 {page?.page ?? query.page ?? 1} / {pages} 页 · {page?.total ?? '—'} 条</span>
          <button type="button" disabled={busy || listLoading || page === undefined || page.page >= pages} onClick={() => { changeQuery({ ...query, page: (query.page ?? 1) + 1 }) }}>下一页</button>
        </AdminToolbar>
      </AdminCard>
      <AdminCard testId="moderation-detail">
        {detail === undefined ? <AdminEmpty>{selected === undefined ? '选择一条记录查看证据与人工审核。' : '正在加载记录详情…'}</AdminEmpty> : <>
          <AdminCardHead><div><AdminCardTitle>{detail.sessionTitle || '对话证据'}</AdminCardTitle>
            <AdminCardMeta>{labels[detail.status]} · <span>版本 {detail.version}</span></AdminCardMeta></div>
          <span className={detail.accountStatus === 'disabled' ? css.warning : css.meta}>
            {detail.accountStatus === 'disabled' ? '账号已停用' : '账号正常'}
          </span>
          </AdminCardHead>
          <dl className={css.identity}>
            <dt>账号 / 学校</dt><dd>{detail.username} / {detail.schoolId}</dd>
            <dt>账户 ID</dt><dd>{detail.userId}</dd><dt>记录 ID</dt><dd>{detail.id}</dd>
            <dt>会话 / 消息</dt><dd>{detail.sessionId} / {detail.messageId}</dd>
            <dt>更新时间</dt><dd>{time(detail.updatedAt)}</dd>
          </dl>
          <h4>用户原文 {detail.textTruncated && <span className={css.warning}>原文已截断</span>}</h4>
          <pre className={css.evidence}>{detail.text || '（空文本）'}</pre>
          <h4>上下文 {detail.contextTruncated && <span className={css.warning}>上下文已截断</span>}</h4>
          <pre className={css.evidence}>{detail.context || '（无上下文）'}</pre>
          <h4>AI 建议与证据</h4>
          {detail.review ? <div className={css.suggestion}>
            <p>{detail.review.risk === 'allow' ? '建议允许' : '建议人工复核'} · {categories[detail.review.category]} · 风险程度：{severity[detail.review.severity]} · 置信度：{Math.round(detail.review.confidence * 100)}%</p>
            <pre className={css.evidence}>{detail.review.reason}</pre>
            {detail.review.evidence.map((part, index) => <pre className={css.evidence} key={index}>{part}</pre>)}
          </div> : <p className={css.meta}>暂无 AI 建议；管理员仍可根据原文作出决定。</p>}
          {detail.error && <p className={css.warning}>审查错误：{detail.error}，请人工复核或重试。</p>}
          {detail.decision && <div className={css.decision}>
            <h4>人工决定：{detail.decision.decision === 'ban' ? '封禁账号' : '驳回风险'}</h4>
            <pre className={css.evidence}>{detail.decision.reason}</pre>
            <p className={css.meta}>{detail.decision.actorKey} · {time(detail.decision.decidedAt)}</p>
          </div>}
          <label className={css.field}>人工审核理由<textarea aria-label="人工审核理由" maxLength={2_000} rows={4} value={reason} disabled={busy || detail.decision !== undefined} onChange={(event) => {
            setReason(event.target.value); setConfirmation(undefined)
          }} placeholder="说明证据、上下文与人工判断依据" /></label>
          <AdminToolbar>
            <button type="button" disabled={!canDecide} onClick={() => { decide('dismiss') }}>驳回风险</button>
            <button className={css.danger} type="button" disabled={!canDecide} onClick={() => { setConfirmation({ id: detail.id, version: detail.version, reason: reason.trim() }) }}>封禁账号</button>
            <button type="button" disabled={!canRetry} onClick={() => {
              const target = detailRef.current
              if (!target) return
              void mutate(async (signal) => {
                const result = await api.retry(target.id, { version: target.version }, signal)
                if (!signal.aborted && live.current) applyDetail(result)
              })
            }}>重试 AI 审查</button>
          </AdminToolbar>
          {confirmation && <div className={css.confirmation} role="alertdialog" aria-label="确认封禁账号" aria-describedby="moderation-ban-explanation">
            <h4>确认封禁账号</h4>
            <p id="moderation-ban-explanation">将停用账号 {detail.username}（学校 {detail.schoolId}，账户 ID {detail.userId}），撤销登录和 API 凭据并停止该账号的活动。请确认已核对证据。</p>
            <pre className={css.evidence}>{confirmation.reason}</pre>
            <AdminToolbar><button className={css.danger} type="button" disabled={busy} onClick={() => { decide('ban', confirmation) }}>确认封禁</button>
              <button type="button" disabled={busy} onClick={() => { setConfirmation(undefined) }}>取消封禁</button></AdminToolbar>
          </div>}
        </>}
      </AdminCard>
    </div>
  </div>
}
