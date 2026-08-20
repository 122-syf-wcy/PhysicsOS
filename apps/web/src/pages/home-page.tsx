import { PhysicsButton } from '@physicsos/ui'
import {
  BookOpen,
  Boxes,
  CircuitBoard,
  Cpu,
  Eye,
  Layers,
  Magnet,
  Play,
  RefreshCw,
  Sparkles,
  Thermometer,
  Zap,
} from 'lucide-react'
import { Link } from 'react-router'
import {
  homeFeatures,
  homeHero,
  homeStats,
  hotTopics,
  learningPath,
  recentContinues,
  recentFiles,
  subjects,
} from '../fixtures/prototype/home.ts'

const subjectIcons = [Boxes, Zap, Magnet, CircuitBoard, Eye, Thermometer]
const featureIcons = [Cpu, Layers, Sparkles, RefreshCw]

export function HomePage() {
  return (
    <main className="mx-auto max-w-[1520px] px-8 pb-12">
      <section className="mt-6 grid min-h-[370px] grid-cols-[46%_1fr] items-center gap-10">
        <div>
          <h1 className="text-[40px] font-bold leading-[1.15] text-[var(--text-primary)]">
            {homeHero.title}
          </h1>
          <p className="mt-4 max-w-[520px] text-[15px] leading-7 text-[var(--text-secondary)]">
            {homeHero.subtitle}
          </p>
          <div className="mt-7 flex gap-3">
            <Link to="/lab">
              <PhysicsButton size="lg">开始探索 →</PhysicsButton>
            </Link>
            <PhysicsButton size="lg" variant="secondary" icon={<Play size={16} />}>
              观看演示
            </PhysicsButton>
          </div>
          <ul className="mt-8 flex flex-wrap gap-5 text-[13px] text-[var(--text-secondary)]">
            {homeFeatures.map((item, index) => {
              const Icon = featureIcons[index] ?? Cpu
              return (
                <li key={item.id} className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-[var(--radius-lg)] bg-[var(--primary-50)] text-[var(--primary-600)]">
                    <Icon size={15} />
                  </span>
                  {item.label}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="relative h-[340px] overflow-hidden rounded-[var(--radius-3xl)] border border-[var(--border-soft)] bg-[linear-gradient(180deg,#eef4ff_0%,#fbfdff_100%)]">
          <div className="absolute left-1/2 top-[46%] size-52 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--primary-200)] bg-[radial-gradient(circle,rgba(59,130,246,0.18),transparent_68%)]" />
          <div className="absolute left-[18%] top-[28%] size-16 rounded-full border border-[var(--border-default)] bg-white/80" />
          <div className="absolute right-[16%] top-[22%] size-12 rounded-full border border-[var(--border-default)] bg-white/80" />
          <div className="absolute bottom-5 right-5 flex gap-6 rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-[var(--glass-strong)] px-5 py-3 text-[12px] backdrop-blur-md">
            {homeStats.map((stat) => (
              <div key={stat.label}>
                <p className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{stat.value}</p>
                <p className="text-[var(--text-tertiary)]">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-5">
        <article className="grid h-[180px] grid-cols-[42%_1fr] overflow-hidden rounded-[var(--radius-3xl)] border border-[var(--border-soft)] bg-white shadow-[var(--shadow-sm)]">
          <div className="flex flex-col justify-center p-6">
            <p className="text-[13px] text-[var(--primary-600)]">Physics Lab</p>
            <h2 className="mt-1 text-[22px] font-semibold">物理实验室</h2>
            <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
              从模型与现象出发，进入可运行、可观察的物理世界。
            </p>
            <Link to="/lab" className="mt-4 w-fit">
              <PhysicsButton>进入实验室 →</PhysicsButton>
            </Link>
          </div>
          <div className="relative bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]">
            <div className="absolute inset-x-8 bottom-8 h-3 rounded-full bg-[var(--primary-200)]" />
            <div className="absolute left-10 bottom-10 h-8 w-16 rounded-md bg-white shadow-[var(--shadow-xs)]" />
            <div className="absolute right-10 top-10 h-16 w-24 rounded-[var(--radius-lg)] border border-[var(--primary-200)] bg-white/80" />
          </div>
        </article>
        <article className="grid h-[180px] grid-cols-[42%_1fr] overflow-hidden rounded-[var(--radius-3xl)] border border-[var(--border-soft)] bg-white shadow-[var(--shadow-sm)]">
          <div className="flex flex-col justify-center p-6">
            <p className="text-[13px] text-[var(--success-600)]">Question Space</p>
            <h2 className="mt-1 text-[22px] font-semibold">试题空间</h2>
            <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
              把静态题目变成可验证、可可视化的物理场景。
            </p>
            <Link to="/questions" className="mt-4 w-fit">
              <PhysicsButton variant="success">进入试题空间 →</PhysicsButton>
            </Link>
          </div>
          <div className="grid place-items-center bg-[linear-gradient(135deg,#e8f8ec,#f8fafc)]">
            <BookOpen size={56} className="text-[var(--success-500)]" />
          </div>
        </article>
      </section>

      <section className="mt-6 grid grid-cols-[24%_46%_30%] gap-4">
        <section className="rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white p-4">
          <h3 className="text-[14px] font-semibold">最近继续</h3>
          <ul className="mt-3 space-y-3">
            {recentContinues.map((item) => (
              <li key={item.id}>
                <p className="text-[13px] font-medium">{item.title}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                  <div className="h-full bg-[var(--primary-500)]" style={{ width: `${item.progress}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-[var(--text-tertiary)]">
                  <span>{item.progress}%</span>
                  <Link to="/lab" className="text-[var(--primary-600)]">
                    继续实验
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white p-4">
          <h3 className="text-[14px] font-semibold">热门专题</h3>
          <div className="mt-3 grid grid-cols-4 gap-3">
            {hotTopics.map((topic, index) => (
              <article key={topic.id} className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-soft)]">
                <div
                  className="h-16"
                  style={{
                    background: [
                      'linear-gradient(135deg,#dbeafe,#e0f2fe)',
                      'linear-gradient(135deg,#dbeafe,#e0e7ff)',
                      'linear-gradient(135deg,#fef3c7,#fee2e2)',
                      'linear-gradient(135deg,#dcfce7,#e0f2fe)',
                    ][index],
                  }}
                />
                <div className="p-2">
                  <p className="text-[12px] font-medium">{topic.title}</p>
                  <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                    {topic.experiments} 实验 · {topic.questions} 题
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white p-4">
          <h3 className="text-[14px] font-semibold">最近文件</h3>
          <ul className="mt-3 space-y-3">
            {recentFiles.map((file) => (
              <li key={file.id} className="flex items-center justify-between text-[12px]">
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    {file.size} · {file.time}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </section>

      <section className="mt-6 grid grid-cols-[66%_34%] gap-4">
        <section className="rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white p-4">
          <h3 className="text-[14px] font-semibold">学习路径</h3>
          <ol className="mt-4 grid grid-cols-5 gap-3">
            {learningPath.map((step) => (
              <li
                key={step.id}
                className={`rounded-[var(--radius-lg)] border px-3 py-3 text-[12px] ${
                  step.state === 'current'
                    ? 'border-[var(--primary-300)] bg-[var(--primary-50)]'
                    : 'border-[var(--border-soft)]'
                }`}
              >
                <p className="text-[11px] text-[var(--text-tertiary)]">{step.id}</p>
                <p className="mt-1 font-medium">{step.title}</p>
                <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                  {step.state === 'done' ? '已完成' : step.state === 'current' ? '进行中' : '未解锁'}
                </p>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white p-4">
          <h3 className="text-[14px] font-semibold">学科分类</h3>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {subjects.map((name, index) => {
              const Icon = subjectIcons[index] ?? Boxes
              return (
                <button
                  key={name}
                  type="button"
                  className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] border border-[var(--border-soft)] text-[12px] hover:bg-[var(--bg-hover)]"
                >
                  <Icon size={18} className="text-[var(--primary-600)]" />
                  {name}
                </button>
              )
            })}
          </div>
        </section>
      </section>
    </main>
  )
}
