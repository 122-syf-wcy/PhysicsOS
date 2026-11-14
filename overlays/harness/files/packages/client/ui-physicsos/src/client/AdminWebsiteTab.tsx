/** Versioned official website configuration and a private, platform-wide inbox. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useState, type ReactNode } from 'react'
import {
  AdminCard, AdminCardActions, AdminCardHead, AdminCardMeta,
  AdminCardTitle, AdminEmpty, AdminToolbar,
} from './AdminPrimitives.tsx'
import { LoadingState } from './LoadingState.tsx'
import { GlassSelect } from './GlassSelect.tsx'
import type { FeedbackStatus } from './notice-api.ts'
import type { PhysicsosKey } from './locales.ts'
import {
  WebsiteApiError, type WebsiteApi, type WebsiteContent,
  type WebsiteContributor, type WebsiteFeedback, type WebsiteTestimonial,
} from './website-api.ts'
import shared from './AdminWorkspace.module.css'
import css from './AdminWebsiteTab.module.css'

type Translate = (key: PhysicsosKey) => string
type Section = 'testimonials' | 'contributors' | 'inbox'
type Entry = WebsiteTestimonial | WebsiteContributor
const LIMIT = 12
const PAGE_SIZE = 50
const COLOR = '#527a9d'
const sorted = <T extends { order: number },>(items: readonly T[]): T[] => [...items].sort((a, b) => a.order - b.order)
const textValid = (value: string, max: number, required = false): boolean => value.trim().length <= max && (!required || value.trim().length > 0)
const urlValid = (value: string): boolean => {
  if (value.trim() === '') return true
  if (value.trim().length > 2048 || !/^https?:\/\//i.test(value.trim())) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === ''
  } catch { return false }
}
const commonValid = (entry: Entry): boolean => textValid(entry.name, 40, true) && textValid(entry.role, 60)
  && /^#[0-9a-f]{6}$/i.test(entry.color) && Number.isSafeInteger(entry.order) && entry.order >= 0
const contentValid = (value: WebsiteContent): boolean => value.testimonials.length <= LIMIT && value.contributors.length <= LIMIT
  && value.testimonials.every(entry => commonValid(entry) && textValid(entry.quote, 280, true) && textValid(entry.topic, 32))
  && value.contributors.every(entry => commonValid(entry) && textValid(entry.project, 70, true) && textValid(entry.description, 220) && urlValid(entry.url) && urlValid(entry.avatar))
const reorder = <T extends Entry,>(items: T[], index: number, direction: number): T[] => {
  const result = [...items]
  const other = result[index + direction]
  const current = result[index]
  if (current === undefined || other === undefined) return items
  result[index] = other
  result[index + direction] = current
  return result.map((entry, order) => ({ ...entry, order }))
}
const fmtTime = (iso: string): string => {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}
const reasonText = (reason: unknown, fallback: string): string => reason instanceof Error ? reason.message : fallback

function TextField({ label, value, onChange, maxLength, multiline = false, type = 'text', required = false }: {
  label: string; value: string; onChange: (value: string) => void; maxLength: number; multiline?: boolean; type?: 'text' | 'url'; required?: boolean
}): ReactNode {
  return <label className={shared.field}>
    <span className={shared.fieldLabel}>{label}</span>
    {multiline
      ? <textarea className={shared.textarea} value={value} maxLength={maxLength} rows={3} required={required} onChange={event => { onChange(event.target.value) }} />
      : <input className={shared.input} value={value} maxLength={maxLength} type={type} required={required} onChange={event => { onChange(event.target.value) }} />}
  </label>
}

function EntryControls({ entry, index, total, onChange, onMove, onRemove, t }: {
  entry: Entry; index: number; total: number; onChange: (patch: { color?: string; order?: number; enabled?: boolean }) => void
  onMove: (direction: number) => void; onRemove: () => void; t: Translate
}): ReactNode {
  return <div className={css.entryControls}>
    <label className={shared.field}>
      <span className={shared.fieldLabel}>{t('admin.website.color')}</span>
      <input className={css.color} type="color" value={entry.color} onChange={event => { onChange({ color: event.target.value }) }} />
    </label>
    <label className={shared.field}>
      <span className={shared.fieldLabel}>{t('admin.website.order')}</span>
      <input className={`${shared.input} ${css.order}`} type="number" min={0} step={1} value={Number.isFinite(entry.order) ? entry.order : ''} onChange={event => { onChange({ order: event.target.value === '' ? Number.NaN : Number(event.target.value) }) }} />
    </label>
    <label className={`${shared.checkbox} ${css.visibility}`}>
      <input type="checkbox" checked={entry.enabled} onChange={event => { onChange({ enabled: event.target.checked }) }} />
      {t('admin.website.enabled')}
    </label>
    <AdminCardActions>
      <button type="button" className={shared.ghost} disabled={index === 0} onClick={() => { onMove(-1) }}>{t('admin.website.moveUp')}</button>
      <button type="button" className={shared.ghost} disabled={index === total - 1} onClick={() => { onMove(1) }}>{t('admin.website.moveDown')}</button>
      <button type="button" className={shared.danger} onClick={onRemove}>{t('admin.website.remove')}</button>
    </AdminCardActions>
  </div>
}

function PublicPreview({ content, section, t }: { content: WebsiteContent; section: Exclude<Section, 'inbox'>; t: Translate }): ReactNode {
  const entries = sorted<Entry>(section === 'testimonials' ? content.testimonials : content.contributors).filter(entry => entry.enabled)
  return <section className={css.preview} aria-label={t('admin.website.preview')}>
    <h3>{t('admin.website.preview')}</h3>
    <p className={css.hint}>{t('admin.website.previewHint')}</p>
    {entries.length === 0 ? <AdminEmpty>{t('admin.website.previewEmpty')}</AdminEmpty> : <div className={css.previewGrid}>
      {entries.map(entry => <article key={entry.id} className={css.previewCard} style={{ borderTopColor: /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : COLOR }}>
        {'quote' in entry ? <>
          {entry.topic && <span className={css.tag}>{entry.topic}</span>}
          <blockquote>{entry.quote}</blockquote>
          <strong>{entry.name}</strong><p>{entry.role}</p>
        </> : <>
          <div className={css.identity}>
            {entry.avatar && urlValid(entry.avatar)
              ? <img src={entry.avatar.trim()} alt={entry.name} loading="lazy" referrerPolicy="no-referrer" />
              : <span className={css.avatar}>{entry.name.slice(0, 1)}</span>}
            <div><strong>{entry.name}</strong><p>{entry.role}</p></div>
          </div>
          <h4>{entry.project}</h4><p>{entry.description}</p>
          {entry.url && urlValid(entry.url) && <a href={entry.url.trim()} target="_blank" rel="noopener noreferrer">{t('admin.website.visitProject')} ↗</a>}
        </>}
      </article>)}
    </div>}
  </section>
}

export function AdminWebsiteTab({ api, t }: { api: WebsiteApi; t: Translate }): ReactNode {
  const [section, setSection] = useState<Section>('testimonials')
  const [saved, setSaved] = useState<WebsiteContent>()
  const [draft, setDraft] = useState<WebsiteContent>()
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [note, setNote] = useState<string>()
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true); setError(undefined); setNote(undefined)
    void api.getContent().then(({ content }) => {
      if (!live) return
      const ordered = { ...content, testimonials: sorted(content.testimonials), contributors: sorted(content.contributors) }
      setSaved(ordered); setDraft(ordered); setConflict(false)
    }).catch((reason: unknown) => {
      if (live) setError(reasonText(reason, t('admin.website.loadError')))
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [api, reload, t])

  const dirty = draft !== undefined && saved !== undefined
    && (JSON.stringify(draft.testimonials) !== JSON.stringify(saved.testimonials) || JSON.stringify(draft.contributors) !== JSON.stringify(saved.contributors))
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn) }
  }, [dirty])

  const change = (update: (value: WebsiteContent) => WebsiteContent): void => {
    setDraft(current => current === undefined ? current : update(current)); setNote(undefined)
  }
  const save = async (): Promise<void> => {
    if (draft === undefined || saved === undefined || busy || loading || conflict || !contentValid(draft)) return
    setBusy(true); setError(undefined); setNote(undefined)
    try {
      const { content } = await api.saveContent({
        expectedVersion: saved.version,
        testimonials: sorted(draft.testimonials).map(entry => ({ ...entry, name: entry.name.trim(), role: entry.role.trim(), quote: entry.quote.trim(), topic: entry.topic.trim() })),
        contributors: sorted(draft.contributors).map(entry => ({ ...entry, name: entry.name.trim(), role: entry.role.trim(), project: entry.project.trim(), description: entry.description.trim(), url: entry.url.trim(), avatar: entry.avatar.trim() })),
      })
      const ordered = { ...content, testimonials: sorted(content.testimonials), contributors: sorted(content.contributors) }
      setSaved(ordered); setDraft(ordered); setNote(t('admin.website.saved'))
    } catch (reason) {
      if (reason instanceof WebsiteApiError && reason.status === 409) {
        setConflict(true); setError(t('admin.website.conflict'))
      } else setError(reasonText(reason, t('admin.website.saveError')))
    } finally { setBusy(false) }
  }
  const addTestimonial = (source?: WebsiteFeedback): void => {
    if (draft === undefined || draft.testimonials.length >= LIMIT || busy || loading) return
    const entry: WebsiteTestimonial = {
      id: randomUUID(), name: '', role: '', quote: source?.body.slice(0, 280) ?? '', topic: '', color: COLOR,
      order: Math.max(-1, ...draft.testimonials.map(item => item.order)) + 1, enabled: false,
      ...(source === undefined ? {} : { sourceFeedbackId: source.id }),
    }
    change(value => ({ ...value, testimonials: [...value.testimonials, entry] }))
    setSection('testimonials')
    if (source !== undefined) setNote(t('admin.website.converted'))
  }

  return <div className={css.root} data-admin-website="">
    <AdminCard>
      <AdminCardHead>
        <div><AdminCardTitle as="h2">{t('admin.tab.website')}</AdminCardTitle><AdminCardMeta>{t('admin.website.hint')}</AdminCardMeta></div>
        <a className={shared.ghost} href="https://physicsos.dongsiwei.com/" target="_blank" rel="noopener noreferrer">{t('admin.website.openSite')} ↗</a>
      </AdminCardHead>
      {saved !== undefined && <div className={css.version}>
        <span>{t('admin.website.version').replace('{version}', String(saved.version))}</span>
        <span>{saved.updatedBy || '—'} · {fmtTime(saved.updatedAt)}</span>
        {dirty && <span className={css.tag}>{t('admin.website.unsaved')}</span>}
      </div>}
      <AdminToolbar className={css.toolbar}>
        <div className={css.sections} role="group" aria-label={t('admin.website.sections')}>
          {(['testimonials', 'contributors', 'inbox'] as const).map(item => <button
            key={item} type="button" className={section === item ? shared.primary : shared.ghost}
            aria-pressed={section === item} onClick={() => { setSection(item) }}
          >{t(`admin.website.${item}`)}</button>)}
        </div>
        <AdminCardActions>
          <button className={shared.ghost} type="button" disabled={busy || loading} onClick={() => { setReload(value => value + 1) }}>
            {dirty || conflict ? t('admin.website.discardReload') : t('admin.website.reload')}
          </button>
          <button className={shared.primary} type="button" disabled={draft === undefined || busy || loading || conflict || !contentValid(draft)} onClick={() => { void save() }}>
            {busy ? t('admin.website.saving') : t('admin.website.save')}
          </button>
        </AdminCardActions>
      </AdminToolbar>
      {error !== undefined && <p className={shared.error} role="alert">{error}</p>}
      {note !== undefined && <p className={css.notice} role="status">{note}</p>}
      {loading && <LoadingState inline>{t('admin.loading')}</LoadingState>}
      {draft !== undefined && !contentValid(draft) && <p className={css.hint}>{t('admin.website.invalid')}</p>}
    </AdminCard>
    {draft !== undefined && section !== 'inbox' && <>
      <div className={css.collectionHeader}>
        <strong>{t(`admin.website.${section}`)} <span className={css.hint}>{draft[section].length} / {LIMIT}</span></strong>
        <button className={shared.ghost} type="button" disabled={busy || loading || draft[section].length >= LIMIT} onClick={() => {
          if (section === 'testimonials') addTestimonial()
          else change(value => ({ ...value, contributors: [...value.contributors, {
            id: randomUUID(), name: '', role: '', project: '', description: '', url: '', avatar: '', color: COLOR,
            order: Math.max(-1, ...value.contributors.map(item => item.order)) + 1, enabled: false,
          }] }))
        }}>{t(section === 'testimonials' ? 'admin.website.addTestimonial' : 'admin.website.addContributor')}</button>
      </div>
      {draft[section].length === 0 && <AdminEmpty>{t(section === 'testimonials' ? 'admin.website.testimonialsEmpty' : 'admin.website.contributorsEmpty')}</AdminEmpty>}
      <fieldset className={css.editor} disabled={busy || loading}>
        {section === 'testimonials' ? draft.testimonials.map((entry, index) => {
          const update = (patch: Partial<WebsiteTestimonial>): void => { change(value => ({ ...value, testimonials: value.testimonials.map(item => item.id === entry.id ? { ...item, ...patch } : item) })) }
          return <AdminCard key={entry.id}>
            <AdminCardHead><AdminCardTitle>{t('admin.website.testimonialItem').replace('{number}', String(index + 1))}</AdminCardTitle><span className={css.tag}>{t(entry.enabled ? 'admin.website.visible' : 'admin.website.hidden')}</span></AdminCardHead>
            <div className={css.fields}>
              <TextField label={t('admin.website.name')} value={entry.name} maxLength={40} required onChange={name => { update({ name }) }} />
              <TextField label={t('admin.website.role')} value={entry.role} maxLength={60} onChange={role => { update({ role }) }} />
            </div>
            <TextField label={t('admin.website.quote')} value={entry.quote} maxLength={280} multiline required onChange={quote => { update({ quote }) }} />
            <TextField label={t('admin.website.topic')} value={entry.topic} maxLength={32} onChange={topic => { update({ topic }) }} />
            <EntryControls entry={entry} index={index} total={draft.testimonials.length} t={t} onChange={update}
              onMove={direction => { change(value => ({ ...value, testimonials: reorder(value.testimonials, index, direction) })) }}
              onRemove={() => { change(value => ({ ...value, testimonials: value.testimonials.filter(item => item.id !== entry.id) })) }} />
          </AdminCard>
        }) : draft.contributors.map((entry, index) => {
          const update = (patch: Partial<WebsiteContributor>): void => { change(value => ({ ...value, contributors: value.contributors.map(item => item.id === entry.id ? { ...item, ...patch } : item) })) }
          return <AdminCard key={entry.id}>
            <AdminCardHead><AdminCardTitle>{t('admin.website.contributorItem').replace('{number}', String(index + 1))}</AdminCardTitle><span className={css.tag}>{t(entry.enabled ? 'admin.website.visible' : 'admin.website.hidden')}</span></AdminCardHead>
            <div className={css.fields}>
              <TextField label={t('admin.website.name')} value={entry.name} maxLength={40} required onChange={name => { update({ name }) }} />
              <TextField label={t('admin.website.role')} value={entry.role} maxLength={60} onChange={role => { update({ role }) }} />
              <TextField label={t('admin.website.avatar')} value={entry.avatar} maxLength={2048} type="url" onChange={avatar => { update({ avatar }) }} />
              <TextField label={t('admin.website.project')} value={entry.project} maxLength={70} required onChange={project => { update({ project }) }} />
            </div>
            <TextField label={t('admin.website.description')} value={entry.description} maxLength={220} multiline onChange={description => { update({ description }) }} />
            <TextField label={t('admin.website.url')} value={entry.url} maxLength={2048} type="url" onChange={url => { update({ url }) }} />
            <p className={css.hint}>{t('admin.website.urlHint')}</p>
            <EntryControls entry={entry} index={index} total={draft.contributors.length} t={t} onChange={update}
              onMove={direction => { change(value => ({ ...value, contributors: reorder(value.contributors, index, direction) })) }}
              onRemove={() => { change(value => ({ ...value, contributors: value.contributors.filter(item => item.id !== entry.id) })) }} />
          </AdminCard>
        })}
      </fieldset>
      <PublicPreview content={draft} section={section} t={t} />
    </>}
    {section === 'inbox' && <FeedbackInbox api={api} t={t} onConvert={addTestimonial}
      canConvert={draft !== undefined && draft.testimonials.length < LIMIT && !busy && !loading}
      sources={draft?.testimonials.flatMap(entry => entry.sourceFeedbackId === undefined ? [] : [entry.sourceFeedbackId]) ?? []} />}
  </div>
}

function FeedbackInbox({ api, t, onConvert, canConvert, sources }: {
  api: WebsiteApi; t: Translate; onConvert: (feedback: WebsiteFeedback) => void; canConvert: boolean; sources: string[]
}): ReactNode {
  const [status, setStatus] = useState<FeedbackStatus>('open')
  const [offset, setOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const [data, setData] = useState<{ feedback: WebsiteFeedback[]; total: number }>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [replies, setReplies] = useState<Record<string, string>>({})

  useEffect(() => {
    let live = true
    setLoading(true); setError(undefined); setData(undefined)
    void api.listFeedback({ status, offset, limit: PAGE_SIZE }).then(result => {
      if (!live) return
      if (offset > 0 && result.total <= offset) { setOffset(Math.max(0, Math.floor((result.total - 1) / PAGE_SIZE) * PAGE_SIZE)); return }
      setData(result)
    }).catch((reason: unknown) => { if (live) setError(reasonText(reason, t('admin.website.inboxError'))) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [api, status, offset, reload, t])

  const reply = async (row: WebsiteFeedback, nextStatus: 'answered' | 'closed'): Promise<void> => {
    const value = (replies[row.id] ?? '').trim()
    if (!value || value.length > 2000 || busy !== undefined) return
    setBusy(row.id); setError(undefined)
    try {
      await api.replyFeedback(row.id, { reply: value, status: nextStatus })
      setReplies(current => ({ ...current, [row.id]: '' })); setReload(value => value + 1)
    } catch (reason) { setError(reasonText(reason, t('admin.website.replyError'))) }
    finally { setBusy(undefined) }
  }

  return <div className={css.inbox}>
    <AdminToolbar>
      <GlassSelect value={status} ariaLabel={t('admin.website.status')} disabled={busy !== undefined}
        options={(['open', 'answered', 'closed'] as const).map(value => ({ value, label: t(`admin.notice.status.${value}`) }))}
        onChange={value => { setStatus(value as FeedbackStatus); setOffset(0) }} />
      <button type="button" className={shared.ghost} disabled={loading || busy !== undefined} onClick={() => { setReload(value => value + 1) }}>{t('admin.website.refreshInbox')}</button>
      <span className={css.hint}>{t('admin.website.privateHint')}</span>
    </AdminToolbar>
    {error !== undefined && <p className={shared.error} role="alert">{error}</p>}
    {loading && <AdminEmpty>{t('admin.loading')}</AdminEmpty>}
    {data !== undefined && <>
      {data.feedback.length === 0 && <AdminEmpty>{t('admin.website.inboxEmpty')}</AdminEmpty>}
      {data.feedback.map(row => {
        const value = replies[row.id] ?? ''
        const valid = value.trim().length > 0 && value.trim().length <= 2000
        return <AdminCard key={row.id} data-website-feedback={row.id}>
          <AdminCardHead><AdminCardTitle>{t(`notice.kind.${row.kind}`)}</AdminCardTitle><span className={css.tag}>{t(`admin.notice.status.${row.status}`)}</span></AdminCardHead>
          <AdminCardMeta>{fmtTime(row.createdAt)}</AdminCardMeta>
          <p className={css.body}>{row.body}</p>
          {(row.contact || row.context) && <dl className={css.details}>
            {row.contact && <><dt>{t('admin.website.contact')}</dt><dd>{row.contact}</dd></>}
            {row.context && <><dt>{t('admin.website.context')}</dt><dd>{row.context}</dd></>}
          </dl>}
          {row.images.length > 0 && <div className={css.images}>
            {row.images.map(image => {
              const protectedPath = `/physicsos/notice/website-feedback/${encodeURIComponent(row.id)}/images/${encodeURIComponent(image.id)}`
              if (image.url !== protectedPath) return null
              return <a href={protectedPath} key={image.id} target="_blank" rel="noopener noreferrer" className={css.imageLink}>
                <img src={protectedPath} alt={image.name || t('admin.website.screenshot')} loading="lazy" referrerPolicy="no-referrer" />
                <span>{image.name || t('admin.website.screenshot')}</span>
              </a>
            })}
          </div>}
          {row.reply && <div className={css.previousReply}><p className={css.body}>{row.reply}</p><small>{row.repliedBy || '—'} · {fmtTime(row.repliedAt ?? '')}</small></div>}
          <fieldset className={css.replyForm} disabled={busy !== undefined}>
            <TextField label={t('admin.website.reply')} value={value} maxLength={2000} multiline onChange={next => { setReplies(current => ({ ...current, [row.id]: next })) }} />
            <AdminCardActions>
              <button type="button" className={shared.primary} disabled={!valid} onClick={() => { void reply(row, 'answered') }}>{busy === row.id ? t('admin.website.saving') : t('admin.website.replySend')}</button>
              <button type="button" className={shared.ghost} disabled={!valid} onClick={() => { void reply(row, 'closed') }}>{t('admin.website.replyClose')}</button>
              <button type="button" className={shared.ghost} disabled={!canConvert || sources.includes(row.id)} onClick={() => { onConvert(row) }}>{t(sources.includes(row.id) ? 'admin.website.alreadyConverted' : 'admin.website.convert')}</button>
            </AdminCardActions>
          </fieldset>
        </AdminCard>
      })}
      <AdminToolbar className={css.pagination}>
        <span>{t('admin.website.pageRange').replace('{start}', String(data.total === 0 ? 0 : offset + 1)).replace('{end}', String(Math.min(offset + PAGE_SIZE, data.total))).replace('{total}', String(data.total))}</span>
        <AdminCardActions>
          <button type="button" className={shared.ghost} disabled={offset === 0 || loading || busy !== undefined} onClick={() => { setOffset(value => Math.max(0, value - PAGE_SIZE)) }}>{t('admin.website.previous')}</button>
          <button type="button" className={shared.ghost} disabled={offset + PAGE_SIZE >= data.total || loading || busy !== undefined} onClick={() => { setOffset(value => value + PAGE_SIZE) }}>{t('admin.website.next')}</button>
        </AdminCardActions>
      </AdminToolbar>
    </>}
  </div>
}
