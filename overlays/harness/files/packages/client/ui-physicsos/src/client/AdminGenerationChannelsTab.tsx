/** Independent generation scopes; the host owns keys, routing and cooldown decisions. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  AdminCard, AdminCardActions, AdminCardHead, AdminCardMeta, AdminCardTitle, AdminEmpty, AdminToolbar,
} from './AdminPrimitives.tsx'
import { AdminSectionTabs } from './AdminSectionTabs.tsx'
import {
  GenerationChannelApiError, type GenerationApiKind, type GenerationChannelApi, type GenerationChannelInput,
  type GenerationChannelView, type GenerationEffort, type GenerationKeyInput, type GenerationKeyView,
  type GenerationModel, type GenerationModelsResult, type GenerationPurpose, type GenerationSettings,
  type GenerationSettingsPatch, type GenerationState,
} from './generation-channel-api.ts'
import shared from './AdminWorkspace.module.css'
import css from './AdminGenerationChannelsTab.module.css'

export interface AdminGenerationChannelsTabProps {
  readonly api: GenerationChannelApi
  readonly language?: 'zh' | 'en'
  /** The parent owns the shell Toast so notices survive tab changes. */
  readonly onNotify?: (notice: { tone: 'success' | 'error'; message: string }) => void
}
const copy = {
  zh: {
    title: '可视化生成通道', text: '文本通道', image: '图片通道', refresh: '刷新', addChannel: '添加通道',
    fallback: '文本通道未配置，或本次所有可用账号均返回 HTTP 429 时，回退到当前会话实际主模型；其他错误不会触发此回退',
    imageHint: '图片使用独立通道和密钥池；现有图片配置可安全迁入，未配置时不会借用文本密钥',
    empty: '尚无独立通道', encryption: '密钥加密未就绪，暂不能添加或替换密钥',
    name: '通道名称', base: '上游 Base URL', api: '接口类型', models: '模型列表', selected: '选用模型',
    auto: '自动选择已声明模型', priority: '优先级', enabled: '启用', context: '上下文窗口', tokens: '输出上限',
    efforts: '推理档位映射（JSON，可选）', addModel: '添加模型', removeModel: '移除模型', noModels: '尚未声明可用模型',
    metadataHint: '仅填写上游已确认的能力；获取模型不会猜测上下文或推理档位',
    save: '保存', cancel: '取消', saving: '正在保存', edit: '编辑通道', remove: '删除', confirm: '确认删除',
    deleteHint: '删除通道会同时移除其密钥配置；已发送的操作可能仍会完成',
    fetchModels: '获取模型', probing: '正在获取模型', modelEmpty: '上游没有返回模型', modelsNeedKey: '先为此通道添加密钥，再获取模型',
    useModel: '加入模型列表', keyLabel: '密钥标签', key: 'API Key', replaceKey: '替换密钥（留空保留原密钥）',
    keyHint: '密钥只在提交时发送；提交、失败或取消后清空，不保存到浏览器',
    weight: '权重', addKey: '添加密钥', editKey: '编辑密钥', reset: '重置冷却', probeKey: '用此密钥获取模型',
    active: '可用', cooldown: '冷却中', disabled: '已停用', until: '冷却至', requests: '请求', failures: '失败',
    'rate-limited': '限流', authFailure: '凭据拒绝', transport: '连接失败', server: '上游故障', client: '请求拒绝',
    settings: '独立重试与冷却策略', retry: '额外重试次数', threshold: '失败阈值', baseCooldown: '冷却基数（毫秒）',
    maxCooldown: '冷却上限（毫秒）', budget: '请求总预算（毫秒）', timeout: '单次超时（毫秒）',
    headers: '响应头超时（毫秒）', recover: '冷却到期自动恢复',
    invalid: '请检查必填项、模型能力和数值范围', loadError: '无法读取生成通道，请重试',
    error: '操作未完成，请重试', auth: '请重新登录后再查看', forbidden: '仅超级管理员可管理生成通道',
    conflict: '配置已被修改，请刷新后重试', saved: '已保存', deleted: '已删除', resetDone: '冷却已重置',
    canceled: '已取消等待；服务端可能已保存，请刷新确认', stale: '配置已更新，当前编辑未保存；请取消后重新打开',
  },
  en: {
    title: 'Visualization generation channels', text: 'Text channel', image: 'Image channel', refresh: 'Refresh', addChannel: 'Add channel',
    fallback: 'Use the actual current-session main model only when text is unconfigured or every available account returns HTTP 429; other errors do not trigger this fallback.',
    imageHint: 'Images use a separate channel and key pool. Existing image settings can be migrated securely; missing configuration never borrows text keys.',
    empty: 'No independent channels yet', encryption: 'Key encryption is unavailable. Adding or replacing keys is disabled.',
    name: 'Channel name', base: 'Upstream Base URL', api: 'API type', models: 'Model list', selected: 'Selected model',
    auto: 'Automatically select a declared model', priority: 'Priority', enabled: 'Enabled', context: 'Context window', tokens: 'Output limit',
    efforts: 'Reasoning effort mapping (optional JSON)', addModel: 'Add model', removeModel: 'Remove model', noModels: 'No usable models declared',
    metadataHint: 'Declare confirmed upstream capabilities only. Model discovery does not guess context or reasoning capabilities.',
    save: 'Save', cancel: 'Cancel', saving: 'Saving', edit: 'Edit channel', remove: 'Delete', confirm: 'Confirm deletion',
    deleteHint: 'Deleting a channel also removes its key configuration. An operation already sent may still complete.',
    fetchModels: 'Get models', probing: 'Getting models', modelEmpty: 'The upstream returned no models', modelsNeedKey: 'Add a key to this channel before getting models',
    useModel: 'Add to model list', keyLabel: 'Key label', key: 'API Key', replaceKey: 'Replacement key (leave blank to retain)',
    keyHint: 'Keys are sent only on submit and cleared on submit, failure or cancel. They are not stored in the browser.',
    weight: 'Weight', addKey: 'Add key', editKey: 'Edit key', reset: 'Reset cooldown', probeKey: 'Get models with this key',
    active: 'Active', cooldown: 'Cooling down', disabled: 'Disabled', until: 'Cooldown until', requests: 'Requests', failures: 'Failures',
    'rate-limited': 'Rate limited', authFailure: 'Credential rejected', transport: 'Connection failed', server: 'Upstream failure', client: 'Request rejected',
    settings: 'Independent retry and cooldown policy', retry: 'Additional retries', threshold: 'Failure threshold', baseCooldown: 'Cooldown base (ms)',
    maxCooldown: 'Cooldown maximum (ms)', budget: 'Total request budget (ms)', timeout: 'Attempt timeout (ms)',
    headers: 'Headers timeout (ms)', recover: 'Recover automatically after cooldown',
    invalid: 'Check required fields, model capabilities and numeric ranges', loadError: 'Could not load generation channels. Retry.',
    error: 'The operation did not complete. Retry.', auth: 'Sign in again to continue', forbidden: 'Only super administrators can manage generation channels',
    conflict: 'Configuration changed. Refresh and retry.', saved: 'Saved', deleted: 'Deleted', resetDone: 'Cooldown reset',
    canceled: 'Stopped waiting. The server may have saved the change; refresh to confirm.', stale: 'Configuration changed. Cancel this unsaved editor and reopen it.',
  },
} as const
type Copy = { readonly [K in keyof typeof copy.zh]: string }
interface ModelDraft { id: string; context: string; tokens: string; efforts: string; name?: string }
interface ChannelDraft { name: string; baseURL: string; api: GenerationApiKind; models: ModelDraft[]; selectedModel: string; priority: string; enabled: boolean }
const toModelDraft = (model: GenerationModel): ModelDraft => ({ id: model.id, context: model.contextWindow?.toString() ?? '',
  tokens: model.maxTokens?.toString() ?? '', efforts: model.reasoningEfforts === undefined ? '' : JSON.stringify(model.reasoningEfforts),
  ...(model.name ? { name: model.name } : {}) })
const newDraft = (purpose: GenerationPurpose): ChannelDraft => ({ name: '',
  baseURL: purpose === 'text' ? 'https://ai.apizn.com' : '', api: purpose === 'text' ? 'openai-responses' : 'openai-images',
  models: [toModelDraft({ id: purpose === 'text' ? 'gpt-6.2-sol' : 'gpt-image-2.5-sunburst' })],
  selectedModel: purpose === 'text' ? 'gpt-6.2-sol' : 'gpt-image-2.5-sunburst', priority: '50', enabled: true })
const fromChannel = (channel: GenerationChannelView): ChannelDraft => ({ name: channel.name, baseURL: channel.baseURL,
  api: channel.api, models: channel.models.map(toModelDraft), selectedModel: channel.selectedModel ?? '',
  priority: String(channel.priority), enabled: channel.enabled })
const integer = (value: string, min: number, max: number): number => {
  const number = Number(value)
  if (!value.trim() || !Number.isSafeInteger(number) || number < min || number > max) throw new Error('invalid')
  return number
}
function modelInput(draft: ModelDraft): GenerationModel {
  const id = draft.id.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(id)) throw new Error('invalid')
  const contextWindow = draft.context.trim() ? integer(draft.context, 1, 4_000_000) : undefined
  const maxTokens = draft.tokens.trim() ? integer(draft.tokens, 1, 1_000_000) : undefined
  if (maxTokens !== undefined && contextWindow !== undefined && maxTokens > contextWindow) throw new Error('invalid')
  let reasoningEfforts: GenerationModel['reasoningEfforts']
  if (draft.efforts.trim()) {
    const value: unknown = JSON.parse(draft.efforts)
    if (value === false) reasoningEfforts = false
    else {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
      const entries = Object.entries(value)
      const allowed = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
      if (!entries.some(([key]) => key !== 'off') || entries.some(([key, entry]) => !allowed.includes(key)
        || !(entry === null && key === 'off') && !(typeof entry === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(entry)))) throw new Error('invalid')
      reasoningEfforts = Object.fromEntries(entries) as Partial<Record<GenerationEffort, string | null>>
    }
  }
  return { id, ...(draft.name ? { name: draft.name } : {}), ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }), ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }) }
}
function channelInput(draft: ChannelDraft, purpose: GenerationPurpose): GenerationChannelInput {
  const base = new URL(draft.baseURL.trim())
  if (!draft.name.trim() || draft.name.trim().length > 60 || base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || purpose === 'image' && draft.api !== 'openai-images' || purpose === 'text' && draft.api === 'openai-images') throw new Error('invalid')
  const models = draft.models.map(modelInput)
  if (models.length > 50 || new Set(models.map(model => model.id)).size !== models.length
    || draft.selectedModel && !models.some(model => model.id === draft.selectedModel)) throw new Error('invalid')
  return { purpose, api: draft.api, name: draft.name.trim(), baseURL: base.toString().replace(/\/+$/, ''), models,
    selectedModel: draft.selectedModel || null, priority: integer(draft.priority, 0, 1000), enabled: draft.enabled }
}
const errorText = (cause: unknown, c: Copy): string => cause instanceof GenerationChannelApiError
  ? cause.status === 401 ? c.auth : cause.status === 403 ? c.forbidden : cause.status === 409 ? c.conflict : c.error : c.error

function ChannelEditor({ purpose, channel, busy, c, onSave, onCancel }: {
  purpose: GenerationPurpose; channel?: GenerationChannelView; busy: boolean; c: Copy;
  onSave: (input: GenerationChannelInput) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => channel ? fromChannel(channel) : newDraft(purpose))
  const [error, setError] = useState('')
  const revision = useRef(channel?.revision)
  const stale = channel !== undefined && revision.current !== channel.revision
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    try { const input = channelInput(draft, purpose); setError(''); onSave(input) } catch { setError(c.invalid) }
  }
  const modelChange = (index: number, update: Partial<ModelDraft>): void => {
    const models = draft.models.map((model, current) => current === index ? { ...model, ...update } : model)
    setDraft({ ...draft, models })
  }
  return <form className={css.editor} onSubmit={submit} aria-label={channel ? c.edit : c.addChannel}>
    <fieldset className={css.fields} disabled={busy || stale}>
      <label className={shared.field}><span className={shared.fieldLabel}>{c.name}</span>
        <input className={shared.input} value={draft.name} maxLength={60} required onChange={event => { setDraft({ ...draft, name: event.target.value }) }} /></label>
      <label className={shared.field}><span className={shared.fieldLabel}>{c.base}</span>
        <input className={shared.input} type="url" value={draft.baseURL} maxLength={500} required onChange={event => { setDraft({ ...draft, baseURL: event.target.value }) }} /></label>
      <label className={shared.field}><span className={shared.fieldLabel}>{c.api}</span>
        <select className={shared.select} value={draft.api} onChange={event => { setDraft({ ...draft, api: event.target.value as GenerationApiKind }) }}>
          {purpose === 'text' ? <><option value="openai-responses">OpenAI Responses</option><option value="openai-completions">OpenAI Completions</option></>
            : <option value="openai-images">OpenAI Images</option>}
        </select></label>
      <label className={shared.field}><span className={shared.fieldLabel}>{c.priority}</span>
        <input className={shared.input} type="number" min={0} max={1000} value={draft.priority} required onChange={event => { setDraft({ ...draft, priority: event.target.value }) }} /></label>
    </fieldset>
    <p className={css.hint}>{c.metadataHint}</p>
    <fieldset className={css.modelList} disabled={busy || stale}><legend>{c.models}</legend>
      {draft.models.map((model, index) => <div className={css.model} key={index}>
        <label className={shared.field}><span className={shared.fieldLabel}>Model ID</span><input className={shared.input} required maxLength={120} value={model.id}
          onChange={event => { modelChange(index, { id: event.target.value }) }} /></label>
        <label className={shared.field}><span className={shared.fieldLabel}>{c.context}</span><input className={shared.input} type="number" min={1} max={4_000_000} value={model.context}
          onChange={event => { modelChange(index, { context: event.target.value }) }} /></label>
        <label className={shared.field}><span className={shared.fieldLabel}>{c.tokens}</span><input className={shared.input} type="number" min={1} max={1_000_000} value={model.tokens}
          onChange={event => { modelChange(index, { tokens: event.target.value }) }} /></label>
        {purpose === 'text' && <label className={`${shared.field} ${css.wide}`}><span className={shared.fieldLabel}>{c.efforts}</span>
          <input className={shared.input} value={model.efforts} maxLength={500} placeholder={'{"low":"low","medium":"medium"}'}
            onChange={event => { modelChange(index, { efforts: event.target.value }) }} /></label>}
        <button type="button" className={shared.ghost} onClick={() => { setDraft({ ...draft,
          models: draft.models.filter((_, current) => current !== index), selectedModel: draft.selectedModel === model.id ? '' : draft.selectedModel }) }}>{c.removeModel}</button>
      </div>)}
      <button type="button" className={shared.ghost} disabled={draft.models.length >= 50} onClick={() => { setDraft({ ...draft, models: [...draft.models, toModelDraft({ id: '' })] }) }}>{c.addModel}</button>
    </fieldset>
    <div className={css.fields}>
      <label className={shared.field}><span className={shared.fieldLabel}>{c.selected}</span>
        <select className={shared.select} value={draft.selectedModel} disabled={busy || stale} onChange={event => { setDraft({ ...draft, selectedModel: event.target.value }) }}>
          <option value="">{c.auto}</option>{draft.models.filter(model => model.id.trim()).map((model, index) => <option key={index} value={model.id}>{model.id}</option>)}
        </select></label>
      <label className={shared.checkbox}><input type="checkbox" checked={draft.enabled} disabled={busy || stale} onChange={event => { setDraft({ ...draft, enabled: event.target.checked }) }} />{c.enabled}</label>
    </div>
    {(error || stale) && <p className={shared.error} role="alert">{stale ? c.stale : error}</p>}
    <AdminCardActions><button type="button" className={shared.ghost} onClick={onCancel}>{c.cancel}</button>
      <button type="submit" className={shared.primary} disabled={busy || stale}>{busy ? c.saving : c.save}</button></AdminCardActions>
  </form>
}

function KeyEditor({ item, busy, encryptionReady, c, onSave, onCancel }: {
  item?: GenerationKeyView; busy: boolean; encryptionReady: boolean; c: Copy;
  onSave: (input: Omit<GenerationKeyInput, 'key'> & { key?: string }) => void; onCancel: () => void;
}) {
  const secret = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const clear = (): void => { if (secret.current) secret.current.value = '' }
  useEffect(() => clear, [])
  useEffect(() => { if (!encryptionReady) clear() }, [encryptionReady])
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = new FormData(event.currentTarget), key = secret.current?.value.trim() ?? ''
    form.delete('generation-secret')
    clear()
    try {
      const weight = integer(String(form.get('weight') ?? ''), 1, 1000)
      const label = String(form.get('label') ?? '').trim()
      if (!item && !key || key && (!/^[\x21-\x7e]{8,4096}$/.test(key) || !encryptionReady)) throw new Error('invalid')
      setError('')
      onSave({ weight, enabled: form.get('enabled') === 'on', ...(label ? { label } : {}), ...(key ? { key } : {}) })
    } catch { setError(c.invalid) }
  }
  return <form className={css.editor} onSubmit={submit} aria-label={item ? c.editKey : c.addKey} autoComplete="off">
    <fieldset className={css.fields} disabled={busy}>
      <label className={shared.field}><span className={shared.fieldLabel}>{c.keyLabel}</span><input name="label" className={shared.input} maxLength={60} defaultValue={item?.label ?? ''} /></label>
      <label className={shared.field}><span className={shared.fieldLabel}>{item ? c.replaceKey : c.key}</span>
        <input ref={secret} className={shared.input} type="password" name="generation-secret" autoComplete="new-password" spellCheck={false} maxLength={4096} disabled={!encryptionReady} /></label>
      <label className={shared.field}><span className={shared.fieldLabel}>{c.weight}</span><input name="weight" className={shared.input} type="number" min={1} max={1000} defaultValue={item?.weight ?? 1} required /></label>
      <label className={shared.checkbox}><input name="enabled" type="checkbox" defaultChecked={item?.enabled ?? true} />{c.enabled}</label>
    </fieldset>
    <p className={css.hint}>{c.keyHint}</p>{error && <p className={shared.error} role="alert">{error}</p>}
    <AdminCardActions><button type="button" className={shared.ghost} onClick={() => { clear(); onCancel() }}>{c.cancel}</button>
      <button type="submit" className={shared.primary} disabled={busy || !item && !encryptionReady}>{busy ? c.saving : c.save}</button></AdminCardActions>
  </form>
}

const policyFields = [
  ['retryCount', 'retry', 0, 5], ['failureThreshold', 'threshold', 1, 20],
  ['cooldownBaseMs', 'baseCooldown', 1000, 3_600_000], ['cooldownMaxMs', 'maxCooldown', 1000, 86_400_000],
  ['requestBudgetMs', 'budget', 1000, 900_000], ['attemptTimeoutMs', 'timeout', 1000, 900_000],
  ['headersTimeoutMs', 'headers', 1000, 300_000],
] as const
function PolicyEditor({ settings, c, busy, onSave, onCancel }: {
  settings: GenerationSettings; c: Copy; busy: boolean; onSave: (patch: GenerationSettingsPatch) => void; onCancel: () => void;
}) {
  const [error, setError] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const numbers = Object.fromEntries(policyFields.map(([key, , min, max]) => [key, integer(String(form.get(key) ?? ''), min, max)])) as Record<typeof policyFields[number][0], number>
      if (numbers.cooldownMaxMs < numbers.cooldownBaseMs || numbers.attemptTimeoutMs > numbers.requestBudgetMs
        || numbers.headersTimeoutMs > numbers.attemptTimeoutMs) throw new Error('invalid')
      setError(''); onSave({ ...numbers, autoRecover: form.get('autoRecover') === 'on' })
    } catch { setError(c.invalid) }
  }
  return <form className={css.editor} onSubmit={submit} aria-label={c.settings}>
    <fieldset className={css.fields} disabled={busy}>{policyFields.map(([key, label, min, max]) => <label key={key} className={shared.field}>
      <span className={shared.fieldLabel}>{c[label]}</span><input className={shared.input} name={key} type="number" min={min} max={max} defaultValue={settings[key]} required /></label>)}
      <label className={shared.checkbox}><input name="autoRecover" type="checkbox" defaultChecked={settings.autoRecover} />{c.recover}</label>
    </fieldset>{error && <p className={shared.error} role="alert">{error}</p>}
    <AdminCardActions><button type="button" className={shared.ghost} onClick={onCancel}>{c.cancel}</button>
      <button type="submit" className={shared.primary} disabled={busy}>{busy ? c.saving : c.save}</button></AdminCardActions>
  </form>
}

export function AdminGenerationChannelsTab({ api, language = 'zh', onNotify }: AdminGenerationChannelsTabProps): ReactNode {
  const c: Copy = copy[language]
  const [purpose, setPurpose] = useState<GenerationPurpose>('text')
  const [state, setState] = useState<GenerationState>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string>()
  const [editor, setEditor] = useState<{ kind: 'channel' | 'key' | 'policy'; id?: string; channelId?: string }>()
  const [confirming, setConfirming] = useState<{ kind: 'channel' | 'key'; id: string }>()
  const [models, setModels] = useState<GenerationModelsResult>()
  const [probeChannel, setProbeChannel] = useState<string>()
  const requestGeneration = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const notify = useRef(onNotify)
  const activeApi = useRef(api)
  const stateApi = useRef(api)
  notify.current = onNotify; activeApi.current = api
  const execute = async <T,>(id: string, job: (signal: AbortSignal) => Promise<T>, success?: string,
    apply?: (value: T) => void): Promise<void> => {
    pending.current?.abort()
    const controller = new AbortController(), generation = ++requestGeneration.current
    pending.current = controller; setBusy(id); setError('')
    try {
      const result = await job(controller.signal)
      if (controller.signal.aborted || generation !== requestGeneration.current || activeApi.current !== api) return
      apply?.(result)
      if (success) notify.current?.({ tone: 'success', message: success })
    } catch (cause) {
      if (controller.signal.aborted || generation !== requestGeneration.current || activeApi.current !== api) return
      const message = errorText(cause, c); setError(message)
      if (success) notify.current?.({ tone: 'error', message })
      if (cause instanceof GenerationChannelApiError && (cause.status === 401 || cause.status === 403)) {
        setState(undefined); setEditor(undefined); setModels(undefined); setProbeChannel(undefined); setConfirming(undefined)
      }
    } finally {
      if (generation === requestGeneration.current) { pending.current = null; setBusy(undefined) }
    }
  }
  useEffect(() => {
    stateApi.current = api
    setState(undefined); setEditor(undefined); setModels(undefined); setProbeChannel(undefined); setConfirming(undefined)
    void execute('load', signal => api.state(signal), undefined, setState)
    return () => { requestGeneration.current++; pending.current?.abort(); pending.current = null }
  }, [api])
  const refresh = (): void => { setEditor(undefined); setModels(undefined); setProbeChannel(undefined); setConfirming(undefined); void execute('load', signal => api.state(signal), undefined, setState) }
  const cancel = (): void => {
    requestGeneration.current++; pending.current?.abort(); pending.current = null; setBusy(undefined)
    setEditor(undefined); setConfirming(undefined); setModels(undefined); setProbeChannel(undefined); setError('')
    if (busy) notify.current?.({ tone: 'error', message: c.canceled })
  }
  const mutate = (id: string, job: (signal: AbortSignal) => Promise<unknown>, message = c.saved): void => {
    if (pending.current) return
    setProbeChannel(undefined)
    void execute(id, async signal => {
      await job(signal)
      return api.state(signal)
    }, message, next => { setState(next); setEditor(undefined); setConfirming(undefined); setModels(undefined) })
  }
  const discover = (channelId: string, keyId?: string): void => {
    setModels(undefined); setProbeChannel(channelId)
    void execute(`models:${channelId}`, signal => api.listChannelModels(channelId, keyId, signal), undefined, setModels)
  }
  if (!state || stateApi.current !== api) return <div className={css.root} data-generation-channels="">
    {error ? <AdminEmpty><p className={shared.error} role="alert">{error}</p><button type="button" className={shared.ghost} onClick={refresh}>{c.refresh}</button></AdminEmpty>
      : <AdminEmpty>{language === 'zh' ? '加载中' : 'Loading'}</AdminEmpty>}
  </div>
  const scope = state[purpose]
  return <div className={css.root} data-generation-channels="" aria-busy={busy !== undefined}>
    <AdminToolbar><div><AdminCardTitle>{c.title}</AdminCardTitle></div>
      <AdminCardActions><button type="button" className={shared.ghost} disabled={busy !== undefined} onClick={refresh}>{c.refresh}</button>
        {busy && <button type="button" className={shared.ghost} onClick={cancel}>{c.cancel}</button>}</AdminCardActions></AdminToolbar>
    {error && !probeChannel && <p className={shared.error} role="alert">{error}</p>}
    {!state.encryptionReady && <p className={shared.error} role="alert">{c.encryption}</p>}
    <AdminSectionTabs label={c.title} items={[{ id: 'text', label: c.text }, { id: 'image', label: c.image }]} value={purpose}
      onChange={next => { cancel(); setPurpose(next) }}>
      <div className={css.scope} data-generation-purpose={purpose}>
        <AdminToolbar><AdminCardMeta>{purpose === 'text' ? c.fallback : c.imageHint}</AdminCardMeta>
          <button type="button" className={shared.primary} disabled={busy !== undefined} onClick={() => { setEditor({ kind: 'channel' }); setConfirming(undefined) }}>{c.addChannel}</button></AdminToolbar>
        {editor?.kind === 'channel' && !editor.id && <AdminCard><ChannelEditor key={`new-${purpose}`} purpose={purpose} c={c} busy={busy !== undefined}
          onCancel={cancel} onSave={input => { mutate('channel:new', signal => api.createChannel(input, signal)) }} /></AdminCard>}
        {scope.channels.length === 0 && <AdminEmpty>{c.empty}</AdminEmpty>}
        {scope.channels.map(channel => <AdminCard key={channel.id} testId={`generation-channel-${channel.id}`}>
          <AdminCardHead><div className={css.heading}><AdminCardTitle>{channel.name}</AdminCardTitle>
            <AdminCardMeta>{channel.baseURL} · {channel.api} · {c.priority} {channel.priority}</AdminCardMeta>
            <AdminCardMeta>{c.selected}: {channel.selectedModel ?? c.auto} · {channel.enabled ? c.enabled : c.disabled}</AdminCardMeta>
          </div><AdminCardActions>
            <button type="button" className={shared.ghost} disabled={busy !== undefined} onClick={() => { setEditor({ kind: 'channel', id: channel.id }); setConfirming(undefined) }}>{c.edit}</button>
            <button type="button" className={shared.ghost} disabled={busy !== undefined || !channel.keys.some(key => key.enabled)} onClick={() => { discover(channel.id) }}>{c.fetchModels}</button>
            <button type="button" className={shared.danger} disabled={busy !== undefined} onClick={() => { setEditor(undefined); setConfirming({ kind: 'channel', id: channel.id }) }}>{c.remove}</button>
          </AdminCardActions></AdminCardHead>
          {confirming?.kind === 'channel' && confirming.id === channel.id && <div className={css.confirm} role="group" aria-label={c.confirm}>
            <p>{c.deleteHint}</p><AdminCardActions><button type="button" className={shared.ghost} onClick={cancel}>{c.cancel}</button>
              <button type="button" className={shared.danger} disabled={busy !== undefined} onClick={() => { mutate(`delete:${channel.id}`, signal => api.deleteChannel(channel.id, signal), c.deleted) }}>{c.confirm}</button></AdminCardActions></div>}
          {editor?.kind === 'channel' && editor.id === channel.id && <ChannelEditor key={channel.id} purpose={purpose} channel={channel} c={c} busy={busy !== undefined}
            onCancel={cancel} onSave={input => { const patch = { api: input.api, name: input.name, baseURL: input.baseURL, models: input.models,
              selectedModel: input.selectedModel, priority: input.priority, enabled: input.enabled }; mutate(`channel:${channel.id}`, signal => api.updateChannel(channel.id, patch, signal)) }} />}
          {channel.models.length > 0 && <ul className={css.models}>{channel.models.map(model => <li key={model.id}><code>{model.id}</code>
            {model.contextWindow !== undefined && <span>{c.context}: {model.contextWindow}</span>}{model.maxTokens !== undefined && <span>{c.tokens}: {model.maxTokens}</span>}
            {model.reasoningEfforts !== undefined && <span>{c.efforts}: {JSON.stringify(model.reasoningEfforts)}</span>}</li>)}</ul>}
          {channel.models.length === 0 && <p className={css.hint}>{c.noModels}</p>}
          {!channel.keys.length && <p className={css.hint}>{c.modelsNeedKey}</p>}
          {probeChannel === channel.id && busy === `models:${channel.id}` && <p className={css.hint} role="status">{c.probing}</p>}
          {probeChannel === channel.id && error && <p className={shared.error} role="alert">{error}</p>}
          {models?.channelId === channel.id && <div className={css.discovery} role="status">{models.models.length ? models.models.map(id => <button key={id} type="button" className={shared.ghost}
            disabled={busy !== undefined || channel.models.some(model => model.id === id) || channel.models.length >= 50}
            onClick={() => { mutate(`model:${channel.id}`, signal => api.updateChannel(channel.id, { models: [...channel.models, { id }] }, signal)) }}
            aria-label={`${c.useModel}: ${id}`}>{id}</button>) : c.modelEmpty}</div>}
          <div className={css.keys}>{channel.keys.map(key => <div key={key.id} className={css.key} data-testid={`generation-key-${key.id}`}>
            <div className={css.keySummary}><span>{key.label}</span><code>•••• {key.keyTail.slice(-4)}</code>
              <span className={!key.enabled ? shared.poolBadgeDisabled : key.status === 'cooldown' ? shared.poolBadgeCooling : shared.poolBadgeActive}>
                {!key.enabled ? c.disabled : key.status === 'cooldown' ? c.cooldown : c.active}</span>
              <span>{c.weight} {key.weight}</span><span>{c.requests} {key.requestCount} · {c.failures} {key.failureCount}</span>
              {key.cooldownReason !== null && <span>{key.cooldownReason === 'auth' ? c.authFailure : c[key.cooldownReason]}</span>}
              {key.lastHttpStatus !== null && <span>HTTP {key.lastHttpStatus}</span>}
              {key.cooldownUntil !== null && <span>{c.until} {new Date(key.cooldownUntil).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</span>}
            </div><AdminCardActions>
              <button type="button" className={shared.ghost} disabled={busy !== undefined} onClick={() => { setEditor({ kind: 'key', id: key.id, channelId: channel.id }); setConfirming(undefined) }}>{c.editKey}</button>
              <button type="button" className={shared.ghost} disabled={busy !== undefined} onClick={() => { mutate(`reset:${key.id}`, signal => api.resetKey(key.id, signal), c.resetDone) }}>{c.reset}</button>
              <button type="button" className={shared.ghost} disabled={busy !== undefined || !key.enabled} onClick={() => { discover(channel.id, key.id) }}>{c.probeKey}</button>
              <button type="button" className={shared.danger} disabled={busy !== undefined} onClick={() => { setEditor(undefined); setConfirming({ kind: 'key', id: key.id }) }}>{c.remove}</button>
            </AdminCardActions>
            {confirming?.kind === 'key' && confirming.id === key.id && <AdminCardActions><button type="button" className={shared.ghost} onClick={cancel}>{c.cancel}</button>
              <button type="button" className={shared.danger} disabled={busy !== undefined} onClick={() => { mutate(`delete:${key.id}`, signal => api.deleteKey(key.id, signal), c.deleted) }}>{c.confirm}</button></AdminCardActions>}
            {editor?.kind === 'key' && editor.id === key.id && <KeyEditor key={key.id} item={key} busy={busy !== undefined} encryptionReady={state.encryptionReady} c={c} onCancel={cancel}
              onSave={input => { mutate(`key:${key.id}`, signal => api.updateKey(key.id, input, signal)) }} />}
          </div>)}</div>
          {editor?.kind === 'key' && !editor.id && editor.channelId === channel.id
            ? <KeyEditor key={`new-key-${channel.id}`} busy={busy !== undefined} encryptionReady={state.encryptionReady} c={c} onCancel={cancel}
              onSave={input => { if (!input.key) return; const keyInput = { ...input, key: input.key }; mutate(`key:new:${channel.id}`, signal => api.addKey(channel.id, keyInput, signal)) }} />
            : <button type="button" className={shared.ghost} disabled={busy !== undefined || !state.encryptionReady} onClick={() => { setEditor({ kind: 'key', channelId: channel.id }); setConfirming(undefined) }}>{c.addKey}</button>}
        </AdminCard>)}
        <AdminCard><AdminCardHead><AdminCardTitle>{c.settings}</AdminCardTitle><button type="button" className={shared.ghost} disabled={busy !== undefined}
          onClick={() => { setEditor({ kind: 'policy' }); setConfirming(undefined) }}>{c.save}</button></AdminCardHead>
          {editor?.kind === 'policy' ? <PolicyEditor key={`${purpose}-${scope.settings.revision}`} settings={scope.settings} c={c} busy={busy !== undefined} onCancel={cancel}
            onSave={patch => { mutate(`policy:${purpose}`, signal => api.updateSettings(purpose, patch, signal)) }} />
            : <AdminCardMeta>{c.retry} {scope.settings.retryCount} · {c.threshold} {scope.settings.failureThreshold} · {c.baseCooldown} {scope.settings.cooldownBaseMs}</AdminCardMeta>}
        </AdminCard>
      </div>
    </AdminSectionTabs>
  </div>
}
