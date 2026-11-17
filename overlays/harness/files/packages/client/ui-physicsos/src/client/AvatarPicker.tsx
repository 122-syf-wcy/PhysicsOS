/** Self-account avatar selection; draft previews never mutate the account store. */
import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import clsx from 'clsx'
import { IconUserOutlineMedium, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthApiError, AuthUser } from './auth-api.ts'
import {
  AVATAR_CATALOG, avatarIdFromUrl, avatarUrlForId, type AvatarId, type AvatarOwner,
} from './avatar-catalog.ts'
import css from './AvatarPicker.module.css'

export interface AvatarImageProps {
  readonly src?: string | undefined
  readonly name: string
  readonly size?: number
  readonly alt?: string | undefined
  readonly className?: string | undefined
  readonly eager?: boolean
  readonly onFailure?: (src: string) => void
}

/**
 * Keep legacy avatar URLs readable. A broken/new/unloaded image has an immediate
 * name/icon fallback, never another person's picture or a fabricated asset.
 * Keying the image state by URL permits retry after switching away and back.
 */
export function AvatarImage(props: AvatarImageProps) {
  return <AvatarImageSource key={props.src ?? ''} {...props} />
}

function AvatarImageSource({ src, name, size = 32, alt, className, eager = false, onFailure }: AvatarImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const initial = Array.from(name.trim())[0]
  const fallback = src === undefined || src === '' || failed
  return (
    <span
      className={clsx(css.imageRoot, className)}
      style={{ '--account-avatar-size': `${size}px` } as CSSProperties}
      role={alt === undefined ? undefined : 'img'}
      aria-hidden={alt === undefined ? true : undefined}
      aria-label={alt === undefined ? undefined : failed ? `${alt}（图片未加载，显示名字首字）` : alt}
      data-avatar-fallback={fallback ? '' : undefined}
    >
      {(!loaded || fallback) && <span className={css.initial} aria-hidden>{initial || <IconUserOutlineMedium size={Math.max(14, Math.round(size * 0.45))} />}</span>}
      {!fallback && <img
        className={clsx(css.image, !loaded && css.imagePending)}
        src={src}
        width={192}
        height={192}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={() => { setLoaded(true) }}
        onError={() => { setFailed(true); if (src !== undefined) onFailure?.(src) }}
      />}
    </span>
  )
}

export interface AvatarPickerProps {
  readonly open: boolean
  readonly user: AuthUser
  readonly setAvatar: (avatarId: AvatarId, expectedOwner: AvatarOwner) => Promise<void>
  readonly onClose: () => void
}

/** Account-keyed lifetime: A → B → A must never revive an old draft or callback. */
export function AvatarPicker({ open, user, setAvatar, onClose }: AvatarPickerProps) {
  if (!open) return null
  return <AvatarPickerAccount
    key={JSON.stringify([user.id, user.schoolId, user.username])}
    user={user}
    setAvatar={setAvatar}
    onClose={onClose}
  />
}

function AvatarPickerAccount({ user, setAvatar, onClose }: Omit<AvatarPickerProps, 'open'>) {
  const currentId = avatarIdFromUrl(user.avatarUrl)
  const [selectedId, setSelectedId] = useState<AvatarId | undefined>(currentId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [previewFailed, setPreviewFailed] = useState<string | undefined>()
  const alive = useRef(true)
  const pending = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const formId = useId()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (error !== undefined) errorRef.current?.focus() }, [error])

  const selected = AVATAR_CATALOG.find(item => item.id === selectedId)
  const previewSrc = selectedId === undefined ? user.avatarUrl : avatarUrlForId(selectedId)
  useEffect(() => { setPreviewFailed(undefined) }, [previewSrc])
  const changed = selectedId !== undefined && selectedId !== currentId
  const close = (): void => { if (!pending.current) onClose() }
  const save = (event: FormEvent): void => {
    event.preventDefault()
    if (!changed || selectedId === undefined || pending.current) return
    pending.current = true
    setSaving(true)
    setError(undefined)
    const owner: AvatarOwner = { id: user.id, schoolId: user.schoolId, username: user.username }
    void (async () => {
      try {
        await setAvatar(selectedId, owner)
        if (alive.current) onClose()
      } catch (cause) {
        if (!alive.current) return
        const code = (cause as AuthApiError | undefined)?.code
        setError(code === 'OWNER_CHANGED' || code === 'UNAUTHENTICATED'
          ? '登录账号或会话已变更，请关闭后重新登录，再选择头像。'
          : '暂未确认头像保存结果，当前页面仍显示原头像。请检查网络后重试，或刷新确认。')
      } finally {
        pending.current = false
        if (alive.current) setSaving(false)
      }
    })()
  }

  return (
    <Modal
      open
      title="选择头像"
      closeLabel="关闭头像选择"
      description="挑选一位与你一起探索物理的伙伴。保存前，当前账号头像不会改变。"
      onClose={close}
      className={css.dialog!}
      contentClassName={css.content!}
      shortcutModal="physicsos-avatar-picker"
      footer={<>
        <button type="button" className={css.cancel} disabled={saving} onClick={close}>取消</button>
        <button type="submit" form={formId} className={css.save} disabled={!changed || saving}>
          {saving ? '正在保存…' : '保存头像'}
        </button>
      </>}
    >
      <form id={formId} onSubmit={save} aria-busy={saving}>
        <div className={css.preview} data-avatar-preview={selectedId ?? 'legacy'}>
          <AvatarImage src={previewSrc} name={user.displayName} size={96} eager alt={`头像预览：${selected?.name ?? '当前头像'}`} onFailure={setPreviewFailed} />
          <div className={css.previewCopy}>
            <p className={css.previewLabel}>{changed ? '预览 · 尚未保存' : '当前头像'}</p>
            <h3 className={css.previewTitle}>{selected?.name ?? user.displayName}</h3>
            <p className={css.previewDescription}>{selected?.description ?? '保留现有头像，或从下方选择新的款式。'}</p>
          </div>
        </div>
        {previewSrc !== undefined && previewFailed === previewSrc && <p className={css.imageHint} role="status">图片暂未加载，先显示名字首字；不会自动替换你的头像。</p>}
        <fieldset className={css.catalog} disabled={saving}>
          <legend className={css.legend}>头像款式</legend>
          <div className={css.grid}>
            {AVATAR_CATALOG.map((item, index) => (
              <label key={item.id} className={clsx(css.option, selectedId === item.id && css.selected)} data-avatar-option={item.id}>
                <input
                  type="radio"
                  name={`${formId}-avatar`}
                  value={item.id}
                  aria-label={item.name}
                  checked={selectedId === item.id}
                  data-modal-autofocus={currentId === item.id || currentId === undefined && index === 0 ? '' : undefined}
                  onChange={() => { setSelectedId(item.id); setError(undefined) }}
                />
                <AvatarImage src={avatarUrlForId(item.id)} name={user.displayName} size={56} />
                <span className={css.optionName}>{item.name}</span>
                <span className={css.optionState}>{currentId === item.id ? '当前使用' : selectedId === item.id ? '已选择' : ' '}</span>
                {selectedId === item.id && <span className={css.selectedMark} aria-hidden />}
              </label>
            ))}
          </div>
        </fieldset>
        <p className={css.culture}>服饰与原创纹样采用贵州文化灵感的当代设计表达，并非特定村寨或仪式服饰的准确复原。</p>
        {error !== undefined && <p className={css.error} role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        <span className={css.srOnly} role="status" aria-live="polite">{saving ? '正在保存头像，请稍候。' : changed ? `已预览${selected?.name ?? ''}，尚未保存。` : '当前头像未改变。'}</span>
      </form>
    </Modal>
  )
}
