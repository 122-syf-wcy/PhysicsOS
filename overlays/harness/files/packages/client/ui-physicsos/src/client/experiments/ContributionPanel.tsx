import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../physics/optics-workspace-runtime.ts'
import { useExperimentSession } from './use-experiment-session.ts'
import { LensControls } from './LensControls.tsx'
import { CommunityExperimentFrame, type CommunityFrameStatus } from './CommunityExperimentFrame.tsx'
import { ContributionFilePicker } from './ContributionFilePicker.tsx'
import {
  contributionApi,
  contributionPreviewUrl,
  contributionFileData,
  type ContributionAuthor,
  type ContributionCatalog,
  type ExperimentPackageView,
} from './contribution-api.ts'
import css from './ContributionPanel.module.css'

const DOCS = '/physicsos/developers/index.html'
const STATUS = { pending: '等待审核', approved: '已审核通过', rejected: '已退回' } as const

export function ContributionAuthorBadge({
  author,
  version,
}: {
  author: ContributionAuthor
  version: string
}) {
  return (
    <div className={css.author}>
      <span className={css.avatar} aria-hidden="true">
        {author.name.slice(0, 1)}
        {author.avatarUrl ? (
          <img
            src={author.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : null}
      </span>
      <div>
        <strong>{author.name}</strong>
        <span>实验创作者 · v{version}</span>
      </div>
      {author.github ? (
        <a href={author.github} target="_blank" rel="noopener noreferrer">
          GitHub ↗
        </a>
      ) : null}
    </div>
  )
}

function CandidatePreview({
  entryUrl,
  protocolVersion,
  onStatusChange,
}: {
  entryUrl: string
  protocolVersion?: 1 | 2
  onStatusChange: (status: CommunityFrameStatus) => void
}) {
  const runtime = useMemo(() => createOpticsWorkspaceRuntime(createConvexLensScene()), [])
  const { session, snapshot } = useExperimentSession(runtime)
  const previewView = useRef<HTMLElement>(null)
  useEffect(() => {
    // Offscreen opaque frames can have animation frames suspended by the browser.
    // Bring the selected renderer into view so its first draw can complete.
    previewView.current?.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <section ref={previewView} className={css.preview} aria-label="候选实验预览">
      <CommunityExperimentFrame
        entryUrl={entryUrl}
        protocolVersion={protocolVersion ?? 1}
        onStatusChange={onStatusChange}
        session={session}
        title="候选三维实验"
      />
      <aside>
        <h3>验证实验条件</h3>
        <LensControls
          snapshot={snapshot}
          preview={session.previewParameter}
          commit={session.commitParameter}
          cancel={session.cancelPreview}
        />
        <p>此预览使用独立实验条件，不会改变你正在操作的实验。</p>
      </aside>
    </section>
  )
}

type ContributionPanelProps =
  { embedded: true; onClose?: never } | { embedded?: false; onClose: () => void }

/** Shared workflow: the contribution page and experiment dialog use the same state and API. */
export function ContributionPanel({ onClose, embedded = false }: ContributionPanelProps) {
  const dialog = useRef<HTMLDivElement>(null)
  const [catalog, setCatalog] = useState<ContributionCatalog>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File>()
  const [avatar, setAvatar] = useState<File>()
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [github, setGithub] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<{
    item: ExperimentPackageView
    entryUrl: string
    instance: number
  }>()
  const previewSequence = useRef(0)
  const [previewStatus, setPreviewStatus] = useState<{
    instance: number
    status: CommunityFrameStatus
  }>()
  const [reason, setReason] = useState('')
  const [rollback, setRollback] = useState<ExperimentPackageView>()
  const alive = useRef(true)

  const refresh = async (): Promise<void> => {
    const data = await contributionApi.catalog()
    if (alive.current) setCatalog(data)
  }
  useEffect(() => {
    alive.current = true
    const previous = document.activeElement
    if (!embedded) dialog.current?.focus()
    void refresh().catch((failure: unknown) => {
      if (alive.current) setError(failure instanceof Error ? failure.message : '无法读取投稿')
    })
    return () => {
      alive.current = false
      if (!embedded && previous instanceof HTMLElement) previous.focus()
    }
  }, [embedded])

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : '操作失败，请稍后重试')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void run(async () => {
      if (file === undefined) throw new Error('请选择实验 ZIP 文件')
      const data = await contributionFileData(file, 20 * 1024 * 1024)
      const avatarDataUrl =
        avatar === undefined ? undefined : await contributionFileData(avatar, 256 * 1024)
      await contributionApi.upload({
        zipBase64: data.slice(data.indexOf(',') + 1),
        author: {
          name: name.trim(),
          ...(bio.trim() ? { bio: bio.trim() } : {}),
          ...(github.trim() ? { github: github.trim() } : {}),
          ...(avatarDataUrl ? { avatarDataUrl } : {}),
        },
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      if (!alive.current) return
      setNotice('实验文件已提交，审核通过后会自动成为凸透镜实验的默认版本。')
      await refresh()
    })
  }
  const openPreview = (item: ExperimentPackageView): void => {
    const instance = ++previewSequence.current
    setPreviewStatus({ instance, status: 'loading' })
    void run(async () => {
      const entryUrl = await contributionPreviewUrl(item)
      if (alive.current) {
        setPreview({ item, entryUrl, instance })
        setReason('')
      }
    })
  }
  const review = (action: 'approve' | 'reject'): void => {
    if (
      preview === undefined ||
      (action === 'approve' &&
        preview.item.protocolVersion === 2 &&
        (previewStatus?.instance !== preview.instance || previewStatus.status !== 'ready'))
    )
      return
    void run(async () => {
      if (action === 'reject' && !reason.trim()) throw new Error('请填写退回原因')
      const { item } = await contributionApi.review(
        preview.item,
        action,
        action === 'reject' ? reason.trim() : undefined,
      )
      if (!alive.current) return
      setNotice(
        action === 'approve'
          ? '已发布。新打开的实验会自动使用此版本；正在进行的实验保持原版本。'
          : '已退回，贡献者可以查看原因并上传新修订。',
      )
      setCatalog(current =>
        current === undefined
          ? current
          : {
            ...current,
            active: action === 'approve' ? item : current.active,
            items: current.items.map(row => (row.id === item.id ? item : row)),
          },
      )
      setPreview(current => (current?.item.id === item.id ? { ...current, item } : current))
      await refresh()
    })
  }
  const panel = (
    <div
      ref={dialog}
      className={`${css.dialog}${embedded ? ` ${css.embedded}` : ''}`}
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-labelledby={embedded ? undefined : 'contribution-title'}
      aria-label={embedded ? '凸透镜实验上传与审核' : undefined}
      tabIndex={embedded ? undefined : -1}
      onKeyDown={(event) => {
        if (embedded) return
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose?.()
        }
        if (event.key !== 'Tab') return
        const nodes = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), iframe, [tabindex="0"]',
        )
        const first = nodes?.[0]
        const last = nodes?.[nodes.length - 1]
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === dialog.current)
        ) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      {!embedded ? (
        <header className={css.header}>
          <div>
            <span>PHYSICSOS · 开发者社区</span>
            <h2 id="contribution-title">贡献凸透镜实验</h2>
            <p>上传独立实验文件，让你的三维装置进入课堂。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭贡献实验">
            ×
          </button>
        </header>
      ) : null}
      <div className={css.content}>
        {error ? (
          <p role="alert" className={css.error}>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className={css.notice}>
            {notice}
          </p>
        ) : null}
        <nav className={css.links} aria-label="贡献资源">
          <a href={`${DOCS}#/start`} target="_blank" rel="noopener noreferrer">
            <img
              src="/physicsos/developers/assets/studio/icon-review.webp"
              width="54"
              height="54"
              alt=""
            />
            <span>
              <strong>开发文档 ↗</strong>
              <small aria-hidden="true">了解规范与提交流程</small>
            </span>
          </a>
          <a
            href="/physicsos/developer-prompts/template"
            download="physicsos-experiment-template-v2.zip"
          >
            <img
              src="/physicsos/developers/assets/studio/icon-upload.webp"
              width="54"
              height="54"
              alt=""
            />
            <span>
              <strong>下载独立模板 ↓</strong>
              <small aria-hidden="true">从可运行的凸透镜样板开始</small>
            </span>
          </a>
          <a href={`${DOCS}#/agents`} target="_blank" rel="noopener noreferrer">
            <img
              src="/physicsos/developers/assets/studio/icon-prompt.webp"
              width="54"
              height="54"
              alt=""
            />
            <span>
              <strong>复制 AGENTS.md ↗</strong>
              <small aria-hidden="true">获取当前版本的开发提示词</small>
            </span>
          </a>
        </nav>
        <form onSubmit={submit} className={css.form}>
          <div className={`${css.wide} ${css.formHeading}`}>
            <span aria-hidden="true">01</span>
            <div>
              <h3>提交一个新版本</h3>
              <p>上传实验包，补充作者信息，审核通过后自动展示。</p>
            </div>
          </div>
          <div className={css.wide}>
            <ContributionFilePicker kind="zip" file={file} disabled={busy} onChange={setFile} />
          </div>
          <label>
            作者显示名
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
              required
              maxLength={80}
              autoComplete="name"
            />
          </label>
          <label>
            GitHub 个人主页
            <input
              value={github}
              onChange={(event) => {
                setGithub(event.target.value)
              }}
              type="url"
              placeholder="https://github.com/your-name"
              maxLength={200}
            />
          </label>
          <label>
            作者简介
            <textarea
              value={bio}
              onChange={(event) => {
                setBio(event.target.value)
              }}
              maxLength={300}
              rows={2}
            />
          </label>
          <ContributionFilePicker
            kind="avatar"
            file={avatar}
            disabled={busy}
            onChange={setAvatar}
          />
          <label className={css.wide}>
            本次修改说明
            <textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value)
              }}
              maxLength={500}
              rows={2}
            />
          </label>
          <div className={css.wide}>
            <button
              type="submit"
              className={css.primary}
              disabled={busy || file === undefined || catalog === undefined}
            >
              {busy ? '正在处理…' : '上传并提交审核'}
            </button>
          </div>
        </form>
        <section className={css.versions} aria-label="实验版本">
          <div className={css.sectionHeading}>
            <h3>{catalog?.canReview ? '投稿审核与发布记录' : '我的投稿与发布记录'}</h3>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run(refresh)
              }}
            >
              刷新
            </button>
          </div>
          {catalog === undefined ? (
            <p role="status">{error ? '未能读取投稿，请点击刷新重试。' : '正在读取版本…'}</p>
          ) : (
            <p>
              当前默认：
              {catalog.active
                ? `v${catalog.active.version} · ${catalog.active.author.name}`
                : 'PhysicsOS 官方三维样板'}
            </p>
          )}
          {catalog?.items.length === 0 ? (
            <p className={css.muted}>还没有投稿。下载模板，开始你的第一个三维实验。</p>
          ) : null}
          {catalog?.items.map(item => (
            <article key={item.id} className={css.version} data-package-id={item.id}>
              <div className={css.sectionHeading}>
                <ContributionAuthorBadge author={item.author} version={item.version} />
                <span className={css.status} data-state={item.status}>
                  {catalog.active?.id === item.id ? '当前默认' : STATUS[item.status]}
                  {(item.protocolVersion ?? 1) === 1 ? <span> · 旧格式</span> : null}
                </span>
              </div>
              {item.author.bio ? <p>{item.author.bio}</p> : null}
              {item.note ? <p>{item.note}</p> : null}
              <small>
                {new Date(item.createdAt).toLocaleString('zh-CN')} · SHA-256{' '}
                {item.sha256.slice(0, 12)}…
              </small>
              {item.rejectionReason ? (
                <p className={css.error}>退回原因：{item.rejectionReason}</p>
              ) : null}
              <div className={css.actions}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    openPreview(item)
                  }}
                >
                  预览 v{item.version}
                </button>
                {catalog.canReview && item.status === 'approved' && catalog.active && catalog.active.id !== item.id && (
                  <button type="button" disabled={busy} onClick={() => { setRollback(item) }}>
                    回滚到此版本
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
        {preview ? (
          <section className={css.review} aria-label="审核预览">
            <div className={css.sectionHeading}>
              <h3>
                预览 v{preview.item.version} · {preview.item.author.name}
                {(preview.item.protocolVersion ?? 1) === 1 ? ' · 旧格式' : ''}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setPreview(undefined)
                }}
              >
                关闭预览
              </button>
            </div>
            {catalog?.canReview ? (
              <div className={css.reviewActions}>
                <a
                  href={`/physicsos/experiments/packages/${encodeURIComponent(preview.item.id)}/archive`}
                  download
                >
                  下载冻结审核 ZIP
                </a>
                <p>下载并核对源码、dist、参考用例和素材许可；该 ZIP 的摘要与审批一致。</p>
                <small aria-label="审核文件 SHA-256" style={{ overflowWrap: 'anywhere' }}>
                  {preview.item.sha256}
                </small>
              </div>
            ) : null}
            <CandidatePreview
              key={preview.instance}
              entryUrl={preview.entryUrl}
              protocolVersion={preview.item.protocolVersion ?? 1}
              onStatusChange={(status) => {
                setPreviewStatus({ instance: preview.instance, status })
              }}
            />
            {catalog?.canReview && preview.item.status === 'pending' ? (
              <div className={css.reviewActions}>
                <p>核对装置、物理结果、手机操作和素材授权后发布。通过后自动替换当前默认版本。</p>
                {preview.item.protocolVersion === 2 ? (
                  <p>首帧兼容确认仅用于辅助审核；仍需核对源码、物理结果和授权。</p>
                ) : null}
                <label>
                  退回原因
                  <textarea
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value)
                    }}
                    maxLength={500}
                    rows={2}
                  />
                </label>
                <div className={css.actions}>
                  <button
                    type="button"
                    className={css.primary}
                    disabled={
                      busy ||
                      (preview.item.protocolVersion === 2 &&
                        (previewStatus?.instance !== preview.instance ||
                          previewStatus.status !== 'ready'))
                    }
                    onClick={() => {
                      review('approve')
                    }}
                  >
                    审核通过并发布
                  </button>
                  <button
                    type="button"
                    disabled={busy || !reason.trim()}
                    onClick={() => {
                      review('reject')
                    }}
                  >
                    退回修改
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        {rollback && catalog?.active ? (
          <section className={css.review} aria-label="确认回滚">
            <h3>
              将默认版本恢复为 v{rollback.version} · {rollback.author.name}？
            </h3>
            <p>当前版本保留在历史中，正在运行的实验不会中断。</p>
            <div className={css.actions}>
              <button
                type="button"
                className={css.primary}
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    if (!catalog.active) return
                    await contributionApi.rollback(rollback.id, catalog.active.id)
                    if (!alive.current) return
                    setRollback(undefined)
                    setNotice('已恢复默认版本。重新打开实验后生效。')
                    await refresh()
                  })
                }}
              >
                确认回滚
              </button>
              <button
                type="button"
                onClick={() => {
                  setRollback(undefined)
                }}
              >
                取消
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
  return embedded ? panel : createPortal(<div className={css.backdrop}>{panel}</div>, document.body)
}
