/**
 * PROTOTYPE ONLY
 * Visual fixture for Home. Not a runtime or learning-model result.
 */

export const homeHero = {
  title: '让看不见的物理过程被看见',
  subtitle:
    '高精度物理仿真与 AI 导学，把力、场、轨迹和能量从想象变成可以暂停、测量和重新推演的数字世界。',
}

export const homeStats = [
  { value: '1,200+', label: '精美仿真实验' },
  { value: '8,600+', label: '精选试题' },
  { value: '96%', label: '学习者推荐' },
] as const

export const homeFeatures = [
  { id: 'engine', label: '实时仿真引擎' },
  { id: 'visual', label: '沉浸式可视化' },
  { id: 'tutor', label: 'AI 智能导学' },
  { id: 'sync', label: '跨端同步' },
] as const

export const recentContinues = [
  {
    id: 'pendulum',
    title: '单摆运动中的机械能守恒',
    progress: 68,
    time: '2 小时前',
  },
  {
    id: 'projectile',
    title: '平抛运动轨迹与落地时间',
    progress: 42,
    time: '昨天 21:16',
  },
  {
    id: 'circuit',
    title: '闭合电路欧姆定律实验',
    progress: 15,
    time: '3 天前',
  },
] as const

export const hotTopics = [
  { id: 'energy', title: '能量与动量', experiments: 12, questions: 36 },
  { id: 'em', title: '电磁学基础', experiments: 18, questions: 54 },
  { id: 'optics', title: '光学现象', experiments: 9, questions: 28 },
  { id: 'thermal', title: '热学与统计', experiments: 7, questions: 21 },
] as const

export const recentFiles = [
  { id: 'f1', name: '电磁感应题集.docx', size: '1.6 MB', time: '今天 09:42' },
  { id: 'f2', name: '带电粒子磁场.sim', size: '420 KB', time: '今天 08:11' },
  { id: 'f3', name: '高二期中试卷.pdf', size: '3.2 MB', time: '昨天 19:05' },
  { id: 'f4', name: '平抛课堂演示.sim', size: '188 KB', time: '周一 16:20' },
] as const

export const learningPath = [
  { id: '01', title: '运动学基础', state: 'done' },
  { id: '02', title: '牛顿定律', state: 'done' },
  { id: '03', title: '能量与动量', state: 'current' },
  { id: '04', title: '电场', state: 'locked' },
  { id: '05', title: '磁场', state: 'locked' },
] as const

export const subjects = ['力学', '电学', '磁场', '电路', '光学', '热学'] as const
