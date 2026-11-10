/**
 * 片中出现的产品数字与文案，全部抄自线上 https://physics.dongsiwei.com 实拍截图（public/shots）。
 * 重拍后先对照截图核对这里，再渲染。
 */
export const FACTS = {
  experiments: 76,
  categories: ['力学', '光学', '声学', '机械波', '浮力与压强', '热学', '电场', '磁场', '电路', '复合场', '电磁感应', '近代物理'],
  projectile: { h: '20 m', v0: '10 m/s', t: '2.02 s', range: '20.2 m' },
  library: { questions: 88, textbooks: 9, resources: 926 },
  examSteps: ['新建试卷', '草稿与审核', '已定稿'],
  question: '为什么洛伦兹力不做功？',
  slogan: ['如果物理是一束光，', '我想让它照到没有实验室的地方'],
  url: 'physics.dongsiwei.com',
}


export const PROJECTILE_FRAMES: string[] = Array.from({ length: 22 }, (_, i) => `shots/projectile/p_${String(i + 1).padStart(3, '0')}.png`)
