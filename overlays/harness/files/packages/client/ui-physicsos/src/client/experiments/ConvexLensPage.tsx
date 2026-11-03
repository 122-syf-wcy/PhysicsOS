import { useEffect, useRef, useState } from 'react'
import type { PhysicsWorkspaceProps } from '../PhysicsWorkspace.tsx'
import { AgentDrawer } from '../AgentDrawer.tsx'
import { ExperimentGuidePanel } from '../ExperimentGuidePanel.tsx'
import { ExperimentReportPanel } from '../ExperimentReportPanel.tsx'
import { experimentMetaOf } from '../physics/experiment-summaries.ts'
import { ContributionPanel, ContributionAuthorBadge } from './ContributionPanel.tsx'
import { CommunityExperimentFrame } from './CommunityExperimentFrame.tsx'
import { contributionApi, type ExperimentPackageView } from './contribution-api.ts'
import { LensControls } from './LensControls.tsx'
import { ExperimentNotebook } from './ExperimentNotebook.tsx'
import { OptionalLensBench } from './OptionalLensBench.tsx'
import { lensBounds, lensParameter, lensReading } from './lens-bench.ts'
import { useExperimentSession } from './use-experiment-session.ts'
import { experimentHref } from './experiment-navigation.ts'
import css from './ExperimentPage.module.css'

const ZONES = [
  { factor: 3, title: '照相机', condition: 'u = 3f', hint: '倒立 · 缩小' },
  { factor: 2, title: '等大成像', condition: 'u = 2f', hint: '倒立 · 等大' },
  { factor: 1.5, title: '投影仪', condition: 'u = 1.5f', hint: '倒立 · 放大' },
  { factor: 1, title: '焦点', condition: 'u = f', hint: '出射光平行' },
  { factor: 0.5, title: '放大镜', condition: 'u = 0.5f', hint: '正立 · 虚像' },
] as const
const TASKS = [
  ['调整物距', '拖动物体，观察它经过 2F 与 F 时，像的位置和大小怎样变化。'],
  ['寻找清晰像', '拖动光屏，直到清晰的实像落在屏上。虚像能用光屏接到吗？'],
  ['记录与比较', '分别记录几组物距、像距与像的性质，用你的数据归纳成像规律。'],
] as const

/** A dedicated learning page; all facts, tools and persistence still use the shared runtime. */
export function ConvexLensPage({
  runtime,
  onSceneChange,
  t,
  onSwitchExperiment,
  onReturnToChat,
  recordAttempt,
  experimentMeta,
}: PhysicsWorkspaceProps) {
  const { session, snapshot, commit } = useExperimentSession(runtime, onSceneChange)
  const [release, setRelease] = useState<ExperimentPackageView | null>()
  const [releaseError, setReleaseError] = useState('')
  const [releaseAttempt, setReleaseAttempt] = useState(0)
  const [contributing, setContributing] = useState(false)
  useEffect(() => {
    let alive = true
    setReleaseError('')
    const pinned = session.getScene()?.metadata.experimentRelease
    void contributionApi
      .catalog()
      .then((catalog) => {
        if (!alive) return
        const selected =
          pinned === undefined
            ? catalog.active
            : catalog.items.find(item => item.id === pinned.id && item.sha256 === pinned.sha256)
        if (selected === undefined || (selected !== null && !selected.entryUrl)) {
          setReleaseError('该记录使用的实验版本暂时无法载入。参数和记录已保留。')
          return
        }
        setRelease(selected)
        session.setRelease(
          selected === null
            ? undefined
            : {
              id: selected.id,
              experimentId: selected.experimentId,
              version: selected.version,
              sha256: selected.sha256,
            },
        )
      })
      .catch(() => {
        if (alive) setReleaseError('暂时无法读取实验版本，请检查网络后重试。')
      })
    return () => {
      alive = false
    }
  }, [session, releaseAttempt])
  const [task, setTask] = useState(0)
  const [panel, setPanel] = useState<'guide' | 'report' | 'agent' | undefined>(undefined)
  const [message, setMessage] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const controls = useRef<HTMLElement>(null)
  const initial = useRef(
    snapshot.inspector
      .flatMap(section => section.parameters ?? [])
      .map(parameter => ({ id: parameter.id, value: parameter.value })),
  )
  const f = lensParameter(snapshot, 'focal-length')
  const u = lensParameter(snapshot, 'object-distance')
  const image = snapshot.view.opticalImages?.[0]
  const screenLit = snapshot.view.opticalScreens?.[0]?.lit === true
  const nature = lensReading(snapshot, 'image-nature')
  const meta = experimentMeta ?? experimentMetaOf('convex-lens')
  const benchProps = {
    snapshot,
    preview: session.previewParameter,
    commit: session.commitParameter,
    cancel: session.cancelPreview,
  }
  const bounds = lensBounds(snapshot)
  const outside = image !== undefined && (image.at.x < bounds.min || image.at.x > bounds.max)
  const reset = (): void => {
    session.cancelPreview()
    for (const parameter of initial.current) session.commitParameter(parameter.id, parameter.value)
    setMessage('装置已复位，实验记录已保留。')
  }
  return (
    <div
      ref={root}
      className={css.page}
      data-physicsos-surface="lab"
      data-physicsos-domain="optics"
      data-experiment-page="convex-lens"
      data-scene-revision={snapshot.sceneRevision}
      data-verification-status={snapshot.status}
      data-image-kind={image?.nature ?? 'none'}
      data-screen-lit={String(screenLit)}
    >
      <header className={css.header}>
        <div>
          <button
            type="button"
            className={css.breadcrumb}
            onClick={onSwitchExperiment ?? onReturnToChat}
          >
            ← 实验中心 <span>/ 光学</span>
          </button>
          <div className={css.titleLine}>
            <h1>凸透镜成像规律</h1>
            <span className={css.subjectTag}>初中物理</span>
          </div>
          <p className={css.subtitle}>移动物体与光屏，让成像的规律自己浮现。</p>
        </div>
        <div className={css.headerActions}>
          <button
            type="button"
            className={css.subtleButton}
            onClick={() => {
              setContributing(true)
            }}
          >
            贡献实验
          </button>
          <button
            type="button"
            className={css.subtleButton}
            onClick={() => {
              setPanel('guide')
            }}
          >
            实验指南
          </button>
          <button
            type="button"
            className={css.subtleButton}
            onClick={() => {
              setPanel('report')
            }}
          >
            实验报告
          </button>
          <button
            type="button"
            className={css.subtleButton}
            onClick={() => {
              const url = new URL(window.location.href)
              url.hash = experimentHref('convex-lens')
              const clipboard = navigator.clipboard as Clipboard | undefined
              if (clipboard === undefined) { setMessage('请从地址栏复制实验链接。'); return }
              void clipboard.writeText(url.toString()).then(
                () => {
                  setMessage('实验链接已复制，可分享给同学。')
                },
                () => {
                  setMessage('暂时无法复制，请从地址栏复制实验链接。')
                },
              )
            }}
          >
            分享实验
          </button>
          <button
            type="button"
            className={css.tutorButton}
            onClick={() => {
              setPanel('agent')
            }}
          >
            <span>✧</span> AI 助教
          </button>
        </div>
      </header>
      {release ? (
        <ContributionAuthorBadge author={release.author} version={release.version} />
      ) : null}
      {message ? (
        <div className={css.notice} role="status">
          {message}
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => {
              setMessage('')
            }}
          >
            ×
          </button>
        </div>
      ) : null}
      {snapshot.branch ? (
        <div className={css.notice}>
          正在探索原题的实验分支。
          <button
            type="button"
            onClick={() => {
              session.cancelPreview()
              if (runtime.restoreOrigin) commit(runtime.restoreOrigin())
            }}
          >
            恢复原题条件
          </button>
        </div>
      ) : null}
      <nav className={css.steps} aria-label="实验步骤">
        {TASKS.map(([title], index) => (
          <button
            type="button"
            key={title}
            className={task === index ? css.stepActive : css.step}
            aria-current={task === index ? 'step' : undefined}
            onClick={() => {
              setTask(index)
            }}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {title}
            <i>→</i>
          </button>
        ))}
      </nav>
      <div className={css.experimentGrid}>
        <section className={css.stageCard} aria-label="光学实验台">
          <div className={css.stageToolbar}>
            <div className={css.viewSwitch}>
              <span>三维实验台{release ? ` · v${release.version}` : ''}</span>
            </div>
            <div className={css.stageActions}>
              <button
                type="button"
                className={css.iconButton}
                aria-label="复位装置"
                title="复位装置"
                onClick={reset}
              >
                ↺
              </button>
              <button
                type="button"
                className={css.iconButton}
                aria-label="全屏实验"
                title="全屏实验"
                onClick={() => {
                  const action = document.fullscreenElement
                    ? document.exitFullscreen()
                    : root.current?.requestFullscreen()
                  void action?.catch(() => {
                    setMessage('当前浏览器不支持全屏，可旋转手机获得更大视野。')
                  })
                }}
              >
                ⛶
              </button>
            </div>
          </div>
          <div className={css.stage}>
            <div className={css.stageCaption}>
              <span className={css.eyebrow}>OPTICAL BENCH</span>
              <span className={css.liveBadge}>
                {snapshot.status === 'verified'
                  ? '● 物理校验通过'
                  : snapshot.status === 'failed'
                    ? '求解失败'
                    : '检查实验条件'}
              </span>
            </div>
            {releaseError ? (
              <div className={css.threeStatus} role="alert">
                <strong>{releaseError}</strong>
                <button
                  type="button"
                  className={css.subtleButton}
                  onClick={() => {
                    setReleaseAttempt(value => value + 1)
                  }}
                >
                  重新读取版本
                </button>
              </div>
            ) : release === undefined ? (
              <div className={css.threeStatus} role="status">
                正在读取实验版本…
              </div>
            ) : release?.entryUrl ? (
              <CommunityExperimentFrame
                key={release.id}
                entryUrl={release.entryUrl}
                session={session}
              />
            ) : (
              <OptionalLensBench {...benchProps} />
            )}
            <div className={css.stageFoot}>
              <span>拖动空白处旋转视角 · 右侧调节实验条件</span>
              <span>长度单位 cm</span>
            </div>
          </div>
          <div className={css.resultStrip} aria-live="polite">
            <div>
              <span>
                像距 <i>v</i>
              </span>
              <strong>
                {lensReading(snapshot, 'image_distance')}
                <small>{image ? ' cm' : ''}</small>
              </strong>
            </div>
            <div>
              <span>
                放大率 <i>m</i>
              </span>
              <strong>
                {lensReading(snapshot, 'magnification')}
                <small>{image ? ' 倍' : ''}</small>
              </strong>
            </div>
            <div className={css.imageResult}>
              <span>像的性质</span>
              <strong>{nature}</strong>
            </div>
          </div>
          <div className={screenLit ? css.screenSuccess : css.screenHint}>
            <span>{screenLit ? '✓' : '◎'}</span>
            <div>
              <strong>
                {screenLit
                  ? '光屏上出现清晰的实像'
                  : image?.nature === 'virtual'
                    ? '虚像不能用光屏承接'
                    : image === undefined
                      ? '物体在焦点上，没有有限位置的像'
                      : '移动光屏，寻找清晰的像'}
              </strong>
              <p>
                {outside ? '像位于当前视野之外，像距读数仍显示真实计算结果。' : TASKS[task]?.[1]}
              </p>
            </div>
          </div>
        </section>
        <aside ref={controls} className={css.controlCard} aria-label="装置参数">
          <div className={css.sectionHeading}>
            <div>
              <span className={css.eyebrow}>CONTROLS</span>
              <h2>调节装置</h2>
            </div>
            <button
              type="button"
              aria-label="检查器"
              className={css.subtleButton}
              onClick={() => {
                controls.current?.querySelector('input')?.focus()
              }}
            >
              参数
            </button>
          </div>
          <LensControls {...benchProps} />
          <div className={css.layers}>
            <label>
              <input
                type="checkbox"
                checked={snapshot.view.visible.rays === true}
                onChange={(event) => {
                  session.cancelPreview()
                  commit(runtime.setObservable('rays', event.target.checked))
                }}
              />
              主光线光路
            </label>
            <label>
              <input
                type="checkbox"
                checked={snapshot.view.visible.image === true}
                onChange={(event) => {
                  session.cancelPreview()
                  commit(runtime.setObservable('image', event.target.checked))
                }}
              />
              显示像的位置
            </label>
          </div>
          <div className={css.law}>
            <span>薄透镜成像公式</span>
            <strong>1/u + 1/v = 1/f</strong>
            <p>理想薄透镜模型 · 忽略像差</p>
          </div>
        </aside>
      </div>
      <section className={css.presets} aria-label="典型成像条件">
        <div className={css.presetHeading}>
          <h2>从五种条件中发现规律</h2>
          <span>保持焦距不变，只改变物距</span>
        </div>
        <div className={css.zoneGrid}>
          {ZONES.map(zone => (
            <button
              type="button"
              key={zone.factor}
              className={Math.abs(u / f - zone.factor) < 0.001 ? css.zoneActive : css.zone}
              onClick={() => {
                session.commitParameter('object-distance', f * zone.factor)
                setTask(1)
              }}
            >
              <span>{zone.title}</span>
              <strong>{zone.condition}</strong>
              <small>{zone.hint}</small>
            </button>
          ))}
        </div>
      </section>
      <ExperimentNotebook session={session} />
      <footer className={css.footer}>
        <span>PhysicsOS · 看见物理，亲手验证</span>
        <button type="button" onClick={onReturnToChat}>
          返回对话 →
        </button>
      </footer>
      {contributing ? (
        <ContributionPanel
          onClose={() => {
            setContributing(false)
          }}
        />
      ) : null}
      {panel === 'guide' && meta ? (
        <ExperimentGuidePanel
          meta={meta}
          title={snapshot.title}
          t={t}
          onClose={() => {
            setPanel(undefined)
          }}
        />
      ) : null}
      {panel === 'report' ? (
        <ExperimentReportPanel
          snapshot={snapshot}
          observations={session.getNotebook()}
          t={t}
          onClose={() => {
            setPanel(undefined)
          }}
        />
      ) : null}
      {panel === 'agent' ? (
        <AgentDrawer
          snapshot={snapshot}
          runtime={runtime}
          onSnapshot={commit}
          t={t}
          onClose={() => {
            setPanel(undefined)
          }}
          {...(recordAttempt === undefined ? {} : { recordAttempt })}
        />
      ) : null}
    </div>
  )
}
