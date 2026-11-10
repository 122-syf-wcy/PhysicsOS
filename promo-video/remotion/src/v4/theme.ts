/**
 * v4 视觉 tokens：全部从线上实拍纹理里取色（public/live4），不另造一套宣传片皮肤。
 *   应用主区 #F4F6F7 · 侧栏 #F9FAFB · 实验中心网格底 #EDEEEF · 卡片 #FFFFFF · 分割线 #DADBDC
 *   首页 Hero 渐变 #F8FBFF→#E4EDFD · 实验卡缩略底 #C5E0F5 · 主蓝 #4176E6（运行按钮 / 选中页签）
 *   品牌标志蓝 #005DFC · 墨色 #0F1115 · 次级灰 #6B7280 · 校验绿 #5C9A76
 */
export const T = {
  bg: '#F4F6F7',
  bgSide: '#F9FAFB',
  bgGrid: '#EDEEEF',
  paper: '#FFFFFF',
  line: '#DADBDC',
  heroA: '#F8FBFF',
  heroB: '#E4EDFD',
  thumb: '#C5E0F5',
  blue: '#4176E6',
  blueDeep: '#2F5BD0',
  mark: '#005DFC',
  ink: '#0F1115',
  ink2: '#6B7280',
  ink3: '#9AA3B2',
  green: '#5C9A76',
  white: '#FFFFFF',
} as const

export const FONT = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
export const NUM = { fontVariantNumeric: 'tabular-nums' as const }

/** 动效性格：平静关怀（教育）——入场 ~36–42f，对称/不对称缓动，不回弹。 */
export const MOTION = {
  enter: 1.3, // 秒
  glide: [0.33, 0, 0.15, 1] as const,
  inOut: [0.45, 0, 0.2, 1] as const,
}
