/**
 * PROTOTYPE ONLY
 * Question Space visual fixture. Not a Question Parser or Agent result.
 */

export const questionHistory = [
  { id: 'q1', title: '带电粒子在匀强磁场中做圆周运动', time: '刚刚' },
  { id: 'q2', title: '速度选择器临界条件', time: '昨天' },
  { id: 'q3', title: '矩形磁场区域出射方向', time: '周一' },
] as const

export const questionSets = [
  { id: 's1', title: '高二物理期中复习', count: 24 },
  { id: 's2', title: '电磁学错题本', count: 11 },
] as const

export const questionDetail = {
  id: 'q1',
  title: '带电粒子在匀强磁场中做圆周运动',
  tags: ['高二物理', '电磁学', '磁场', '圆周运动'],
  stem: '一质量为 m、电荷量为 +q 的粒子以速度 v₀ 垂直进入磁感应强度为 B 的匀强磁场。磁场方向垂直纸面向里。求粒子做圆周运动的半径 r，以及运动半周所用时间 t。',
  known: ['B = 1.00 T', 'm = 1.00 kg（展示用）', 'q = 1.00 C（展示用）', 'v₀ = 5.00×10⁶ m/s'],
  goals: ['轨道半径 r', '运动半周时间 t'],
  steps: [
    {
      title: '受力与运动性质',
      body: '洛伦兹力提供向心力，轨迹为圆周。',
      tex: 'qv_0 B = \\dfrac{m v_0^2}{r}',
    },
    {
      title: '求半径',
      body: '整理得到半径表达式。',
      tex: 'r = \\dfrac{m v_0}{q B}',
    },
    {
      title: '求半周时间',
      body: '周期的一半。',
      tex: 't = \\dfrac{\\pi m}{q B}',
    },
    {
      title: '出射速度',
      body: '匀强磁场不改变速率。',
      tex: 'v = v_0',
    },
  ],
  related: [
    { id: 'r1', title: '带电粒子进出有界磁场', difficulty: 4 },
    { id: 'r2', title: '速度选择器', difficulty: 3 },
  ],
}
