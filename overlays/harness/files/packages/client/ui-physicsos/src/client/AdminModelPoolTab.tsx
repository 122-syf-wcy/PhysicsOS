/**
 * SUPER_ADMIN console for the platform model pool.
 *
 * The server owns routing, cooldowns, and credentials; this screen is the
 * maintenance surface. It deliberately keeps raw key material local to the
 * form that creates or replaces a key, and every list view renders the host's
 * four-character tail only.
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'

import type {
  ModelPoolApi,
  ModelPoolChannelView,
  ModelPoolKeyView,
  ModelPoolProbeResult,
  ModelPoolState,
} from './model-pool-api.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './AdminWorkspace.module.css'

export interface AdminModelPoolTabProps {
  readonly api: ModelPoolApi
  readonly t: (key: PhysicsosKey) => string
}

interface ChannelDraft {
  name: string
  baseURL: string
  models: string
  priority: string
  enabled: boolean
}

interface KeyDraft {
  label: string
  key: string
  weight: string
  enabled: boolean
}

interface PolicyDraft {
  retryCount: string
  failureThreshold: string
  cooldownBaseMs: string
  cooldownMaxMs: string
  autoRecover: boolean
}

const emptyChannel = (): ChannelDraft => ({
  name: '',
  baseURL: '',
  models: '',
  priority: '50',
  enabled: true,
})

const emptyKey = (): KeyDraft => ({ label: '', key: '', weight: '1', enabled: true })

const channelDraft = (channel: ModelPoolChannelView): ChannelDraft => ({
  name: channel.name,
  baseURL: channel.baseURL,
  models: channel.models.join(', '),
  priority: String(channel.priority),
  enabled: channel.enabled,
})

const keyDraft = (key: ModelPoolKeyView): KeyDraft => ({
  label: key.label,
  key: '',
  weight: String(key.weight),
  enabled: key.enabled,
})

const policyDraft = (state: ModelPoolState): PolicyDraft => ({
  retryCount: String(state.settings.retryCount),
  failureThreshold: String(state.settings.failureThreshold),
  cooldownBaseMs: String(state.settings.cooldownBaseMs),
  cooldownMaxMs: String(state.settings.cooldownMaxMs),
  autoRecover: state.settings.autoRecover,
})

const parseModels = (value: string): string[] =>
  [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(item => item !== ''))]

const parseInteger = (value: string): number | undefined => {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

const omitRecord = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const next: Record<string, T> = {}
  for (const [entry, value] of Object.entries(record)) {
    if (entry !== key) next[entry] = value
  }
  return next
}

const fmtTime = (iso: string | null): string => {
  if (iso === null || iso === '') return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

const fmtPercent = (value: number): string => `${(value * 100).toFixed(value === 0 ? 0 : 1)}%`

const statusKey = (key: ModelPoolKeyView): PhysicsosKey => {
  if (!key.enabled) return 'admin.modelPool.status.disabled'
  return key.status === 'cooldown'
    ? 'admin.modelPool.status.cooldown'
    : 'admin.modelPool.status.active'
}

const statusClass = (key: ModelPoolKeyView): string | undefined => {
  if (!key.enabled) return css.poolBadgeDisabled
  return key.status === 'cooldown' ? css.poolBadgeCooling : css.poolBadgeActive
}

const ChannelEditor = ({
  draft,
  busy,
  onChange,
  onSave,
  onCancel,
  t,
}: {
  readonly draft: ChannelDraft
  readonly busy: boolean
  readonly onChange: (next: ChannelDraft) => void
  readonly onSave: () => void
  readonly onCancel: () => void
  readonly t: (key: PhysicsosKey) => string
}) => (
  <div className={css.poolEditor} data-testid="model-pool-channel-editor">
    <div className={css.poolFieldGrid}>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('admin.modelPool.channel.name')}</span>
        <input className={css.input} value={draft.name}
          onChange={(event) => { onChange({ ...draft, name: event.target.value }) }} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('admin.modelPool.channel.baseURL')}</span>
        <input className={css.input} value={draft.baseURL}
          onChange={(event) => { onChange({ ...draft, baseURL: event.target.value }) }} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('admin.modelPool.channel.models')}</span>
        <input className={css.input} value={draft.models}
          placeholder={t('admin.modelPool.channel.modelsHint')}
          onChange={(event) => { onChange({ ...draft, models: event.target.value }) }} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('admin.modelPool.channel.priority')}</span>
        <input className={css.input} type="number" min={1} max={1000} value={draft.priority}
          onChange={(event) => { onChange({ ...draft, priority: event.target.value }) }} />
      </label>
    </div>
    <div className={css.poolInline}>
      <label className={css.checkbox}>
        <input type="checkbox" checked={draft.enabled}
          onChange={(event) => { onChange({ ...draft, enabled: event.target.checked }) }} />
        {t('admin.modelPool.channel.enabled')}
      </label>
      <div className={css.actions}>
        <button type="button" className={css.ghost} disabled={busy}
          onClick={onCancel}>{t('admin.modelPool.cancel')}</button>
        <button type="button" className={css.primary} disabled={busy}
          onClick={onSave}>{t('admin.modelPool.save')}</button>
      </div>
    </div>
  </div>
)

export function AdminModelPoolTab({ api, t }: AdminModelPoolTabProps): React.ReactNode {
  const [state, setState] = useState<ModelPoolState | undefined>()
  const [policy, setPolicy] = useState<PolicyDraft | undefined>()
  const [newChannel, setNewChannel] = useState<ChannelDraft>(emptyChannel)
  const [channelEdits, setChannelEdits] = useState<Record<string, ChannelDraft>>({})
  const [newKeys, setNewKeys] = useState<Record<string, KeyDraft>>({})
  const [keyEdits, setKeyEdits] = useState<Record<string, KeyDraft>>({})
  const [probes, setProbes] = useState<Record<string, ModelPoolProbeResult>>({})
  const [busy, setBusy] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api.state()
      setState(next)
      setPolicy(policyDraft(next))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.modelPool.loadError'))
    }
  }, [api, t])

  useEffect(() => { void load() }, [load])

  const execute = async (
    id: string,
    job: () => Promise<unknown>,
    success: PhysicsosKey = 'admin.modelPool.saved',
  ): Promise<boolean> => {
    setBusy(id)
    setError(undefined)
    setNotice(undefined)
    try {
      await job()
      await load()
      setNotice(t(success))
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.modelPool.error'))
      return false
    } finally {
      setBusy(undefined)
    }
  }

  const saveChannel = (id: string, draft: ChannelDraft): void => {
    const priority = parseInteger(draft.priority)
    if (draft.name.trim() === '' || draft.baseURL.trim() === '' || priority === undefined) {
      setError(t('admin.modelPool.channel.invalid'))
      return
    }
    void execute(`channel:edit:${id}`, () => api.updateChannel(id, {
      name: draft.name.trim(),
      baseURL: draft.baseURL.trim(),
      models: parseModels(draft.models),
      priority,
      enabled: draft.enabled,
    })).then((ok) => {
      if (!ok) return
      setChannelEdits(current => omitRecord(current, id))
    })
  }

  const addChannel = (): void => {
    const priority = parseInteger(newChannel.priority)
    if (newChannel.name.trim() === '' || newChannel.baseURL.trim() === '' || priority === undefined) {
      setError(t('admin.modelPool.channel.invalid'))
      return
    }
    void execute('channel:new', () => api.createChannel({
      name: newChannel.name.trim(),
      baseURL: newChannel.baseURL.trim(),
      models: parseModels(newChannel.models),
      priority,
      enabled: newChannel.enabled,
    })).then((ok) => { if (ok) setNewChannel(emptyChannel()) })
  }

  const addKey = (channelId: string): void => {
    const draft = newKeys[channelId] ?? emptyKey()
    const weight = parseInteger(draft.weight)
    if (draft.key.trim() === '' || weight === undefined || weight < 1 || weight > 1000) {
      setError(t('admin.modelPool.key.invalid'))
      return
    }
    void execute(`key:new:${channelId}`, () => api.addKey(channelId, {
      key: draft.key.trim(),
      weight,
      enabled: draft.enabled,
      ...(draft.label.trim() === '' ? {} : { label: draft.label.trim() }),
    })).then((ok) => {
      if (ok) setNewKeys(current => ({ ...current, [channelId]: emptyKey() }))
    })
  }

  const saveKey = (key: ModelPoolKeyView): void => {
    const draft = keyEdits[key.id] ?? keyDraft(key)
    const weight = parseInteger(draft.weight)
    if (weight === undefined || weight < 1 || weight > 1000) {
      setError(t('admin.modelPool.key.invalid'))
      return
    }
    void execute(`key:edit:${key.id}`, () => api.updateKey(key.id, {
      label: draft.label.trim(),
      weight,
      enabled: draft.enabled,
      ...(draft.key.trim() === '' ? {} : { key: draft.key.trim() }),
    })).then((ok) => {
      if (!ok) return
      setKeyEdits(current => omitRecord(current, key.id))
    })
  }

  const savePolicy = (): void => {
    if (policy === undefined) return
    const retryCount = parseInteger(policy.retryCount)
    const failureThreshold = parseInteger(policy.failureThreshold)
    const cooldownBaseMs = parseInteger(policy.cooldownBaseMs)
    const cooldownMaxMs = parseInteger(policy.cooldownMaxMs)
    if (retryCount === undefined || failureThreshold === undefined
      || cooldownBaseMs === undefined || cooldownMaxMs === undefined) {
      setError(t('admin.modelPool.settings.invalid'))
      return
    }
    void execute('settings', () => api.updateSettings({
      retryCount,
      failureThreshold,
      cooldownBaseMs,
      cooldownMaxMs,
      autoRecover: policy.autoRecover,
    }))
  }

  if (state === undefined || policy === undefined) {
    return (
      <div className={css.poolRoot} data-admin-model-pool="">
        <p className={error === undefined ? css.empty : css.error}>{error ?? t('admin.loading')}</p>
      </div>
    )
  }

  return (
    <div className={css.poolRoot} data-admin-model-pool="">
      <div className={css.poolHeader}>
        <div>
          <h2 className={css.cardTitle}>{t('admin.modelPool.title')}</h2>
          <p className={css.cardMeta}>{t('admin.modelPool.hint')}</p>
        </div>
        <button type="button" className={css.ghost} disabled={busy !== undefined}
          onClick={() => { void load() }}>{t('admin.modelPool.refresh')}</button>
      </div>

      {!state.encryptionReady && <p className={css.error}>{t('admin.modelPool.encryptionOff')}</p>}
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
      {notice !== undefined && <p className={css.note} role="status">{notice}</p>}

      <div className={css.poolStats}>
        <span className={css.stat}><strong>{state.stats.channels}</strong>{t('admin.modelPool.stats.channels')}</span>
        <span className={css.stat}><strong>{state.stats.keys}</strong>{t('admin.modelPool.stats.keys')}</span>
        <span className={css.stat}><strong>{state.stats.activeKeys}</strong>{t('admin.modelPool.stats.active')}</span>
        <span className={clsx(css.stat, state.stats.cooldownKeys > 0 && css.statWarn)}>
          <strong>{state.stats.cooldownKeys}</strong>{t('admin.modelPool.stats.cooldown')}
        </span>
        <span className={css.stat}><strong>{state.stats.disabledKeys}</strong>{t('admin.modelPool.stats.disabled')}</span>
      </div>

      <section className={css.card}>
        <div className={css.cardHead}>
          <div>
            <h3 className={css.cardTitle}>{t('admin.modelPool.settings.title')}</h3>
            <p className={css.cardMeta}>{t('admin.modelPool.settings.hint')}</p>
          </div>
          <button type="button" className={css.primary} disabled={busy === 'settings'}
            onClick={savePolicy}>
            {busy === 'settings' ? t('admin.modelPool.saving') : t('admin.modelPool.settings.save')}
          </button>
        </div>
        <div className={css.poolFieldGrid}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('admin.modelPool.settings.retryCount')}</span>
            <input className={css.input} type="number" min={0} max={5}
              value={policy.retryCount}
              onChange={(event) => { setPolicy({ ...policy, retryCount: event.target.value }) }} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('admin.modelPool.settings.failureThreshold')}</span>
            <input className={css.input} type="number" min={1} max={20}
              value={policy.failureThreshold}
              onChange={(event) => { setPolicy({ ...policy, failureThreshold: event.target.value }) }} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('admin.modelPool.settings.cooldownBase')}</span>
            <input className={css.input} type="number" min={1000}
              value={policy.cooldownBaseMs}
              onChange={(event) => { setPolicy({ ...policy, cooldownBaseMs: event.target.value }) }} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('admin.modelPool.settings.cooldownMax')}</span>
            <input className={css.input} type="number" min={1000}
              value={policy.cooldownMaxMs}
              onChange={(event) => { setPolicy({ ...policy, cooldownMaxMs: event.target.value }) }} />
          </label>
        </div>
        <label className={css.checkbox}>
          <input type="checkbox" checked={policy.autoRecover}
            onChange={(event) => { setPolicy({ ...policy, autoRecover: event.target.checked }) }} />
          {t('admin.modelPool.settings.autoRecover')}
        </label>
      </section>

      <section className={css.card}>
        <h3 className={css.cardTitle}>{t('admin.modelPool.channel.create')}</h3>
        <ChannelEditor
          draft={newChannel}
          busy={busy === 'channel:new'}
          onChange={setNewChannel}
          onSave={addChannel}
          onCancel={() => { setNewChannel(emptyChannel()) }}
          t={t}
        />
      </section>

      {state.channels.length === 0 && <p className={css.empty}>{t('admin.modelPool.channel.empty')}</p>}
      {state.channels.map((channel) => {
        const editing = channelEdits[channel.id]
        const draft = editing ?? channelDraft(channel)
        const adding = newKeys[channel.id] ?? emptyKey()
        return (
          <section key={channel.id} className={css.card} data-testid={`model-pool-channel-${channel.id}`}>
            <div className={css.cardHead}>
              <div className={css.cardBody}>
                <h3 className={css.cardTitle}>{channel.name}</h3>
                <p className={css.cardMeta}>
                  {channel.baseURL} · {t('admin.modelPool.channel.priority')} {channel.priority}
                  {' · '}
                  <span className={channel.enabled ? css.poolBadgeActive : css.poolBadgeDisabled}>
                    {channel.enabled ? t('admin.modelPool.status.enabled') : t('admin.modelPool.status.disabled')}
                  </span>
                </p>
                <p className={css.cardMeta}>
                  {channel.models.length === 0
                    ? t('admin.modelPool.channel.allModels')
                    : channel.models.join(', ')}
                </p>
              </div>
              <div className={css.actions}>
                <button type="button" className={css.ghost} disabled={busy !== undefined}
                  onClick={() => {
                    setChannelEdits(current => ({
                      ...current,
                      [channel.id]: editing === undefined ? channelDraft(channel) : draft,
                    }))
                  }}>{t('admin.modelPool.edit')}</button>
                <button type="button" className={css.danger} disabled={busy !== undefined}
                  onClick={() => {
                    if (!globalThis.confirm(t('admin.modelPool.channel.deleteConfirm').replace('{name}', channel.name))) return
                    void execute(`channel:delete:${channel.id}`, () => api.deleteChannel(channel.id))
                  }}>{t('admin.modelPool.delete')}</button>
              </div>
            </div>
            {editing !== undefined && (
              <ChannelEditor
                draft={draft}
                busy={busy === `channel:edit:${channel.id}`}
                onChange={(next) => { setChannelEdits(current => ({ ...current, [channel.id]: next })) }}
                onSave={() => { saveChannel(channel.id, draft) }}
                onCancel={() => {
                  setChannelEdits(current => omitRecord(current, channel.id))
                }}
                t={t}
              />
            )}

            <div className={css.poolKeyTableWrap}>
              <table className={css.poolKeyTable}>
                <thead>
                  <tr>
                    <th>{t('admin.modelPool.key.name')}</th>
                    <th>{t('admin.modelPool.key.tail')}</th>
                    <th>{t('admin.modelPool.key.status')}</th>
                    <th>{t('admin.modelPool.key.weight')}</th>
                    <th>{t('admin.modelPool.key.requests')}</th>
                    <th>{t('admin.modelPool.key.failureRate')}</th>
                    <th>{t('admin.modelPool.key.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {channel.keys.map((key) => {
                    const keyEdit = keyEdits[key.id]
                    const probe = probes[key.id]
                    return (
                      <tr key={key.id} data-testid={`model-pool-key-${key.id}`}>
                        <td>
                          {keyEdit === undefined
                            ? key.label
                            : (
                              <input className={css.input} value={keyEdit.label}
                                onChange={(event) => {
                                  setKeyEdits(current => ({ ...current, [key.id]: { ...keyEdit, label: event.target.value } }))
                                }} />
                            )}
                          <small className={css.poolKeyMeta}>
                            {t('admin.modelPool.key.lastUsed')} {fmtTime(key.lastUsedAt)}
                          </small>
                          {key.lastError !== null && <small className={css.poolKeyError}>{key.lastError}</small>}
                        </td>
                        <td><code>•••• {key.keyTail}</code></td>
                        <td><span className={statusClass(key)}>{t(statusKey(key))}</span></td>
                        <td>
                          {keyEdit === undefined
                            ? key.weight
                            : (
                              <input className={css.input} type="number" min={1} max={1000} value={keyEdit.weight}
                                onChange={(event) => {
                                  setKeyEdits(current => ({ ...current, [key.id]: { ...keyEdit, weight: event.target.value } }))
                                }} />
                            )}
                        </td>
                        <td>{key.requestCount}</td>
                        <td>{fmtPercent(key.failureRate)}</td>
                        <td>
                          <div className={css.poolKeyActions}>
                            <button type="button" className={css.ghost} disabled={busy !== undefined}
                              onClick={() => {
                                void execute(`key:reset:${key.id}`, () => api.resetKey(key.id))
                              }}>{t('admin.modelPool.key.reset')}</button>
                            <button type="button" className={css.ghost} disabled={busy !== undefined}
                              onClick={() => {
                                setBusy(`key:test:${key.id}`)
                                setError(undefined)
                                void api.testKey(key.id).then(
                                  (result) => { setProbes(current => ({ ...current, [key.id]: result })) },
                                  (cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) },
                                ).finally(() => { setBusy(undefined) })
                              }}>{t('admin.modelPool.key.test')}</button>
                            <button type="button" className={css.ghost} disabled={busy !== undefined}
                              onClick={() => {
                                setKeyEdits(current => current[key.id] === undefined
                                  ? { ...current, [key.id]: keyDraft(key) }
                                  : current)
                              }}>{t('admin.modelPool.key.edit')}</button>
                            <button type="button" className={css.danger} disabled={busy !== undefined}
                              onClick={() => {
                                if (!globalThis.confirm(t('admin.modelPool.key.deleteConfirm').replace('{name}', key.label))) return
                                void execute(`key:delete:${key.id}`, () => api.deleteKey(key.id))
                              }}>{t('admin.modelPool.delete')}</button>
                          </div>
                          {keyEdit !== undefined && (
                            <div className={css.poolKeyEdit}>
                              <input className={css.input} type="password" placeholder={t('admin.modelPool.key.replace')}
                                value={keyEdit.key}
                                onChange={(event) => {
                                  setKeyEdits(current => ({ ...current, [key.id]: { ...keyEdit, key: event.target.value } }))
                                }} />
                              <label className={css.checkbox}>
                                <input type="checkbox" checked={keyEdit.enabled}
                                  onChange={(event) => {
                                    setKeyEdits(current => ({ ...current, [key.id]: { ...keyEdit, enabled: event.target.checked } }))
                                  }} />
                                {t('admin.modelPool.status.enabled')}
                              </label>
                              <div className={css.actions}>
                                <button type="button" className={css.ghost}
                                  onClick={() => {
                                    setKeyEdits(current => omitRecord(current, key.id))
                                  }}>{t('admin.modelPool.cancel')}</button>
                                <button type="button" className={css.primary}
                                  onClick={() => { saveKey(key) }}>{t('admin.modelPool.save')}</button>
                              </div>
                            </div>
                          )}
                          {probe !== undefined && (
                            <small className={probe.ok ? css.poolProbeOk : css.poolKeyError}>
                              {probe.ok ? t('admin.modelPool.key.testOk') : t('admin.modelPool.key.testFailed')}
                              {' '}{probe.status} · {probe.latencyMs} ms · {probe.message}
                            </small>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {channel.keys.length === 0 && (
                    <tr>
                      <td colSpan={7} className={css.empty}>{t('admin.modelPool.key.empty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={css.poolAddKey}>
              <span className={css.fieldLabel}>{t('admin.modelPool.key.add')}</span>
              <div className={css.poolAddKeyRow}>
                <input className={css.input} placeholder={t('admin.modelPool.key.name')}
                  value={adding.label}
                  onChange={(event) => {
                    setNewKeys(current => ({ ...current, [channel.id]: { ...adding, label: event.target.value } }))
                  }} />
                <input className={css.input} type="password" placeholder={t('admin.modelPool.key.key')}
                  value={adding.key}
                  onChange={(event) => {
                    setNewKeys(current => ({ ...current, [channel.id]: { ...adding, key: event.target.value } }))
                  }} />
                <input className={css.input} type="number" min={1} max={1000} placeholder={t('admin.modelPool.key.weight')}
                  value={adding.weight}
                  onChange={(event) => {
                    setNewKeys(current => ({ ...current, [channel.id]: { ...adding, weight: event.target.value } }))
                  }} />
                <label className={css.checkbox}>
                  <input type="checkbox" checked={adding.enabled}
                    onChange={(event) => {
                      setNewKeys(current => ({ ...current, [channel.id]: { ...adding, enabled: event.target.checked } }))
                    }} />
                  {t('admin.modelPool.status.enabled')}
                </label>
                <button type="button" className={css.primary} disabled={busy === `key:new:${channel.id}`}
                  onClick={() => { addKey(channel.id) }}>{t('admin.modelPool.key.addButton')}</button>
              </div>
            </div>
          </section>
        )
      })}

      {state.audit.length > 0 && (
        <section className={css.card}>
          <h3 className={css.cardTitle}>{t('admin.modelPool.audit')}</h3>
          <ul className={css.poolAudit}>
            {state.audit.map(row => (
              <li key={row.id}>
                <span>{fmtTime(row.at)}</span>
                <strong>{row.action}</strong>
                <span>{row.target}</span>
                <small>{row.actorKey}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
