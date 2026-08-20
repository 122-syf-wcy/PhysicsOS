import {
  AgentStatus,
  Formula,
  PhysicsButton,
  PhysicsCanvasFrame,
  PhysicsPanel,
  PhysicsTabs,
  QuantityInput,
  QuestionStep,
  QuestionTag,
} from '@physicsos/ui'
import { ChevronLeft, MoreHorizontal, Star, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { QuestionCanvasVisual } from '../canvas/question-canvas-visual.tsx'
import { questionDetail, questionHistory, questionSets } from '../fixtures/prototype/question.ts'

export function QuestionSpacePage() {
  const [tab, setTab] = useState('visual')

  return (
    <main className="grid h-[calc(100vh-62px)] grid-cols-1 gap-3 overflow-hidden px-4 py-3 xl:grid-cols-[235px_minmax(0,1fr)_410px]">
      <PhysicsPanel title="试题空间">
        <div className="flex flex-col gap-2">
          <PhysicsButton icon={<Upload size={14} />}>上传题目</PhysicsButton>
          <PhysicsButton variant="secondary">新建题目</PhysicsButton>
        </div>
        <p className="mt-5 text-[12px] font-semibold">历史记录</p>
        <ul className="mt-2 space-y-2">
          {questionHistory.map((item) => (
            <li key={item.id} className="rounded-[var(--radius-lg)] border border-[var(--border-soft)] p-2">
              <p className="text-[12px] font-medium">{item.title}</p>
              <p className="text-[11px] text-[var(--text-tertiary)]">{item.time}</p>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[12px] font-semibold">我的题集</p>
        <ul className="mt-2 space-y-2">
          {questionSets.map((set) => (
            <li key={set.id} className="flex justify-between text-[12px]">
              <span>{set.title}</span>
              <span className="text-[var(--text-tertiary)]">{set.count}</span>
            </li>
          ))}
        </ul>
      </PhysicsPanel>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white">
        <header className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="inline-flex items-center gap-1 text-[13px] text-[var(--text-secondary)]">
              <ChevronLeft size={16} />
              返回
            </Link>
            <h1 className="text-[18px] font-semibold">{questionDetail.title}</h1>
          </div>
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Star size={16} />
            <MoreHorizontal size={16} />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {questionDetail.tags.map((tag) => (
              <QuestionTag key={tag} tone="primary">
                {tag}
              </QuestionTag>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-[1.1fr_0.9fr] gap-4">
            <p className="text-[14px] leading-7 text-[var(--text-primary)]">{questionDetail.stem}</p>
            <div className="rounded-[var(--radius-lg)] border border-[var(--border-soft)] bg-[var(--bg-subtle)] p-2">
              <QuestionCanvasVisual />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <article className="rounded-[var(--radius-lg)] bg-[var(--primary-50)] p-3">
              <h2 className="text-[13px] font-semibold">已知条件</h2>
              <ul className="mt-2 list-disc pl-4 text-[12px] leading-6">
                {questionDetail.known.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="rounded-[var(--radius-lg)] bg-[var(--bg-subtle)] p-3">
              <h2 className="text-[13px] font-semibold">求解目标</h2>
              <ul className="mt-2 list-disc pl-4 text-[12px] leading-6">
                {questionDetail.goals.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
          <PhysicsTabs
            className="mt-4 px-0"
            items={[
              { id: 'understand', label: '题目理解' },
              { id: 'visual', label: '可视化' },
              { id: 'steps', label: '解析步骤' },
              { id: 'variant', label: '变式练习' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'visual' ? (
            <div className="mt-3 grid grid-cols-[1fr_220px] gap-3">
              <PhysicsCanvasFrame
                className="h-[280px]"
                toolbar={
                  <>
                    <span className="text-[12px]">运动轨迹 · 受力分析 · 速度方向</span>
                    <span className="text-[11px] text-[var(--text-tertiary)]">重置 / 播放 / 慢放</span>
                  </>
                }
              >
                <QuestionCanvasVisual />
              </PhysicsCanvasFrame>
              <article className="rounded-[var(--radius-lg)] border border-[var(--border-soft)] p-3">
                <p className="text-[12px] font-semibold">场景信息</p>
                <div className="mt-2 space-y-2">
                  <QuantityInput defaultValue="1.00" unit="T" />
                  <QuantityInput defaultValue="1.00" unit="C" />
                  <QuantityInput defaultValue="1.00" unit="kg" />
                  <QuantityInput defaultValue="5.00e6" unit="m/s" />
                </div>
              </article>
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-[var(--text-secondary)]">该页签使用同一题目 fixture，后续接入 Runtime。</p>
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-[var(--border-soft)] px-4 py-3">
          <div className="flex gap-2">
            <PhysicsButton variant="secondary">上一题</PhysicsButton>
            <PhysicsButton>下一题</PhysicsButton>
          </div>
          <Link to="/lab">
            <PhysicsButton variant="success">在物理世界中打开 →</PhysicsButton>
          </Link>
        </footer>
      </section>

      <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
        <PhysicsPanel title="AI 解析" extra={<span className="text-[11px] text-[var(--text-tertiary)]">深度推理模式</span>}>
          <AgentStatus tone="success" label="已完成思考：洛伦兹力提供向心力，轨迹为圆周。" />
          <div className="mt-4 space-y-4">
            {questionDetail.steps.map((step, index) => (
              <QuestionStep key={step.title} index={index + 1} title={step.title}>
                <p>{step.body}</p>
                <Formula tex={step.tex} display />
              </QuestionStep>
            ))}
          </div>
        </PhysicsPanel>
        <PhysicsPanel title="推荐相关题">
          <ul className="space-y-2">
            {questionDetail.related.map((item) => (
              <li key={item.id} className="rounded-[var(--radius-lg)] border border-[var(--border-soft)] p-2 text-[12px]">
                <p className="font-medium">{item.title}</p>
                <p className="text-[var(--text-tertiary)]">难度 {item.difficulty} / 5</p>
              </li>
            ))}
          </ul>
        </PhysicsPanel>
      </div>
    </main>
  )
}
