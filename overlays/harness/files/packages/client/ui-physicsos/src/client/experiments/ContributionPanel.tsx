import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoadingState } from '../LoadingState.tsx'
import type { CommunityFrameStatus } from './CommunityExperimentFrame.tsx'
import { ExperimentCandidatePreview } from './ExperimentCandidatePreview.tsx'
import { ContributionFilePicker } from './ContributionFilePicker.tsx'
import { GlassSelect } from '../GlassSelect.tsx'
import {
  canUploadExperiment,
  contributionTargets,
  DEFAULT_CONTRIBUTION_EXPERIMENT,
} from './contribution-targets.ts'
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

type ContributionPanelProps = (
  { embedded: true; onClose?: never } | { embedded?: false; onClose: () => void }
) & { mode?: 'upload' | 'review' }

/** Shared workflow: the contribution page and experiment dialog use the same state and API. */
export function ContributionPanel({
  onClose,
  embedded = false,
  mode = 'upload',
}: ContributionPanelProps) {
  const reviewOnly = mode === 'review'
  const [experimentId, setExperimentId] = useState(DEFAULT_CONTRIBUTION_EXPERIMENT)
  const [reviewFilter, setReviewFilter] = useState('pending')
  const [reviewExperiment, setReviewExperiment] = useState('all')
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
  const catalogSequence = useRef(0)

  const refresh = async (): Promise<void> => {
    const token = ++catalogSequence.current
    const data = await (reviewOnly
      ? contributionApi.reviewQueue()
      : contributionApi.catalog(experimentId))
    if (alive.current && token === catalogSequence.current) setCatalog(data)
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
      catalogSequence.current++
      if (!embedded && previous instanceof HTMLElement) previous.focus()
    }
  }, [embedded, experimentId, reviewOnly])

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
      if (!canUploadExperiment(experimentId))
        throw new Error('该实验尚未开放上传，请选择已开放的实验。')
      if (file === undefined) throw new Error('请选择实验 ZIP 文件')
      const data = await contributionFileData(file, 20 * 1024 * 1024)
      const avatarDataUrl =
        avatar === undefined ? undefined : await contributionFileData(avatar, 256 * 1024)
      await contributionApi.upload(
        {
          zipBase64: data.slice(data.indexOf(',') + 1),
          author: {
            name: name.trim(),
            ...(bio.trim() ? { bio: bio.trim() } : {}),
            ...(github.trim() ? { github: github.trim() } : {}),
            ...(avatarDataUrl ? { avatarDataUrl } : {}),
          },
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        experimentId,
      )
      if (!alive.current) return
      setNotice(
        `实验文件已提交，审核通过后会自动成为${contributionTargets.find(item => item.value === experimentId)?.label ?? '对应实验'}的默认版本。`,
      )
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
        (preview.item.protocolVersion ?? 1) !== 1 &&
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
            active:
                action === 'approve' && item.experimentId === experimentId ? item : current.active,
            ...(action === 'approve'
              ? {
                activeByExperiment: {
                  ...current.activeByExperiment,
                  [item.experimentId]: item,
                },
              }
              : {}),
            items: current.items.map(row => (row.id === item.id ? item : row)),
          },
      )
      setPreview(current => (current?.item.id === item.id ? { ...current, item } : current))
      await refresh()
    })
  }
  if (reviewOnly && catalog && !catalog.canReview) {
    return (
      <div className={css.error} role="alert">
        只有平台管理员可以查看实验审核队列，请检查当前登录账号。
      </div>
    )
  }
  const activeFor = (id: string): ExperimentPackageView | null =>
    catalog?.activeByExperiment?.[id] ??
    (catalog?.active?.experimentId === id ? catalog.active : null)
  const visibleItems = catalog?.items.filter(
    item =>
      !reviewOnly ||
      ((reviewFilter === 'all' || item.status === reviewFilter) &&
        (reviewExperiment === 'all' || item.experimentId === reviewExperiment)),
  )
  const selectedLabel =
    contributionTargets.find(item => item.value === experimentId)?.label ?? experimentId
  const rollbackActive = rollback === undefined ? null : activeFor(rollback.experimentId)
  const canRollback = (item: ExperimentPackageView): boolean => {
    const active = activeFor(item.experimentId)
    return (
      catalog?.canReview === true &&
      item.status === 'approved' &&
      active !== null &&
      active.id !== item.id
    )
  }
  const panel = (
    <div
      ref={dialog}
      className={`${css.dialog}${embedded ? ` ${css.embedded}` : ''}${reviewOnly ? ` ${css.reviewOnly}` : ''}`}
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-labelledby={embedded ? undefined : 'contribution-title'}
      aria-label={embedded ? (reviewOnly ? '实验审核队列' : '实验上传与审核') : undefined}
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
            <h2 id="contribution-title">贡献实验</h2>
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
        {!reviewOnly && (
          <>
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
                href={
                  experimentId === 'convex-lens'
                    ? '/physicsos/developer-prompts/template'
                    : `/physicsos/experiments/${encodeURIComponent(experimentId)}/template`
                }
                download={
                  experimentId === 'convex-lens'
                    ? 'physicsos-experiment-template-v2.zip'
                    : `${experimentId}-template-v3.zip`
                }
              >
                <img
                  src="/physicsos/developers/assets/studio/icon-upload.webp"
                  width="54"
                  height="54"
                  alt=""
                />
                <span>
                  <strong>下载独立模板 ↓</strong>
                  <small aria-hidden="true">从可运行的{selectedLabel}样板开始</small>
                </span>
              </a>
              <a
                href={`${DOCS}?experiment=${encodeURIComponent(experimentId)}#/agents`}
                target="_blank"
                rel="noopener noreferrer"
              >
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
              <label className={css.wide}>
                <span>对应实验</span>
                <GlassSelect
                  value={experimentId}
                  options={contributionTargets}
                  ariaLabel="对应实验"
                  disabled={busy}
                  className={css.experimentSelect}
                  onChange={(value) => {
                    if (value === experimentId || !canUploadExperiment(value)) return
                    setExperimentId(value)
                    setCatalog(undefined)
                    setFile(undefined)
                    setPreview(undefined)
                    setRollback(undefined)
                    setError('')
                    setNotice('')
                  }}
                />
                <small>全部已有实验均可上传；ZIP 清单中的 experimentId 必须与所选实验一致。</small>
              </label>
              <div className={css.wide}>
                <ContributionFilePicker
                  key={experimentId}
                  kind="zip"
                  experimentName={selectedLabel}
                  file={file}
                  disabled={busy}
                  onChange={setFile}
                />
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
          </>
        )}
        <section className={css.versions} aria-label="实验版本">
          <div className={css.sectionHeading}>
            <h3>
              {reviewOnly
                ? '实验投稿审核'
                : catalog?.canReview
                  ? '投稿审核与发布记录'
                  : '我的投稿与发布记录'}
            </h3>
            {reviewOnly && (
              <GlassSelect
                value={reviewFilter}
                options={[
                  { value: 'pending', label: '待审核' },
                  { value: 'approved', label: '已通过' },
                  { value: 'rejected', label: '已退回' },
                  { value: 'all', label: '全部记录' },
                ]}
                ariaLabel="审核状态"
                disabled={busy}
                onChange={(value) => {
                  setReviewFilter(value)
                  setPreview(undefined)
                  setRollback(undefined)
                }}
              />
            )}
            {reviewOnly && (
              <GlassSelect
                value={reviewExperiment}
                options={[{ value: 'all', label: '全部实验' }, ...contributionTargets]}
                ariaLabel="筛选实验"
                disabled={busy}
                onChange={(value) => {
                  setReviewExperiment(value)
                  setPreview(undefined)
                  setRollback(undefined)
                }}
              />
            )}
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
          {reviewOnly && catalog && (
            <div className={css.reviewStats}>
              <span>
                <strong>{catalog.items.filter(item => item.status === 'pending').length}</strong>
                待审核
              </span>
              <span>
                <strong>{catalog.items.filter(item => item.status === 'approved').length}</strong>
                已通过
              </span>
              <span>
                <strong>{catalog.items.filter(item => item.status === 'rejected').length}</strong>
                已退回
              </span>
            </div>
          )}
          {reviewOnly && (
            <p className={css.muted}>
              全部实验投稿集中审核；预览加载的是上传 ZIP 中的实际作品，物理结果来自对应的平台引擎。
            </p>
          )}
          {catalog === undefined ? (
            error ? <p role="status">未能读取投稿，请点击刷新重试。</p> : <LoadingState inline>正在读取版本…</LoadingState>
          ) : (
            <p>
              当前默认：
              {reviewOnly && reviewExperiment === 'all'
                ? `${Object.values(catalog.activeByExperiment ?? {}).filter(Boolean).length} 个实验已使用社区版本`
                : (reviewOnly ? activeFor(reviewExperiment) : catalog.active)
                  ? `v${(reviewOnly ? activeFor(reviewExperiment) : catalog.active)?.version} · ${(reviewOnly ? activeFor(reviewExperiment) : catalog.active)?.author.name}`
                  : 'PhysicsOS 官方实验样板'}
            </p>
          )}
          {visibleItems?.length === 0 ? (
            <p className={css.muted}>
              {reviewOnly
                ? '当前筛选下没有实验投稿，可切换审核状态查看历史记录。'
                : '还没有投稿。下载模板，开始你的第一个三维实验。'}
            </p>
          ) : null}
          {catalog &&
            visibleItems?.map(item => (
              <article key={item.id} className={css.version} data-package-id={item.id}>
                <div className={css.sectionHeading}>
                  <ContributionAuthorBadge author={item.author} version={item.version} />
                  <span className={css.status} data-state={item.status}>
                    {activeFor(item.experimentId)?.id === item.id
                      ? '当前默认'
                      : STATUS[item.status]}
                    {(item.protocolVersion ?? 1) === 1 ? <span> · 旧格式</span> : null}
                  </span>
                </div>
                <p className={css.muted}>
                  对应实验：
                  {contributionTargets.find(target => target.value === item.experimentId)
                    ?.label ?? item.experimentId}
                </p>
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
                  {canRollback(item) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRollback(item)
                      }}
                    >
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
            <ExperimentCandidatePreview
              key={preview.instance}
              experimentId={preview.item.experimentId}
              entryUrl={preview.entryUrl}
              protocolVersion={preview.item.protocolVersion ?? 1}
              onStatusChange={(status) => {
                setPreviewStatus({ instance: preview.instance, status })
              }}
            />
            {catalog?.canReview && preview.item.status === 'pending' ? (
              <div className={css.reviewActions}>
                <p>核对装置、物理结果、手机操作和素材授权后发布。通过后自动替换当前默认版本。</p>
                {(preview.item.protocolVersion ?? 1) !== 1 ? (
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
                      ((preview.item.protocolVersion ?? 1) !== 1 &&
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
        {rollback && rollbackActive ? (
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
                    await contributionApi.rollback(
                      rollback.id,
                      rollbackActive.id,
                      rollback.experimentId,
                    )
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
