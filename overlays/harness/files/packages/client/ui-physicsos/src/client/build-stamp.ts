/**
 * 构建期注入的版本戳。
 *
 * `__PHYSICSOS_VERSION__` 与 `__PHYSICSOS_BUILT_AT__` 由
 * `tsdown.config.ts` 在打包时替换成字面量(见那里的注释),所以这里读到的
 * 是构建期常量,不是运行期探测。测试环境没有注入时退化成开发占位,而不是
 * 抛异常 —— 一个版本号不该让界面起不来。
 */
declare const __PHYSICSOS_VERSION__: string | undefined
declare const __PHYSICSOS_BUILT_AT__: string | undefined
declare const __PHYSICSOS_BUILT_DAY__: string | undefined

/** 当前构建的版本号;未注入时为 `dev`。 */
export const PHYSICSOS_VERSION: string =
  typeof __PHYSICSOS_VERSION__ === 'string' ? __PHYSICSOS_VERSION__ : 'dev'

/** 当前构建的时刻(ISO 字符串);未注入时为 `unknown`。 */
export const PHYSICSOS_BUILT_AT: string =
  typeof __PHYSICSOS_BUILT_AT__ === 'string' ? __PHYSICSOS_BUILT_AT__ : 'unknown'

/**
 * 构建日期 `YYYY-MM-DD`,由构建机按**本地时间**算好注入。
 *
 * 不在浏览器里格式化 `PHYSICSOS_BUILT_AT`:那会用读者时区,让同一个包在不同
 * 时区显示出不同的「构建日」,而这是产物的属性。
 */
export const PHYSICSOS_BUILT_DAY: string =
  typeof __PHYSICSOS_BUILT_DAY__ === 'string' ? __PHYSICSOS_BUILT_DAY__ : 'unknown'

/**
 * 报障用的单行版本串 —— 「版本 · 构建日」。只到日:秒级精度对排障没有额外
 * 价值,却会让人误以为那是发布时间。
 * @returns `版本 · 构建日`,如 `0.1.0 · 2026-09-25`;未注入时构建日为「未注入」。
 */
export const buildStamp = (): string => {
  const day = PHYSICSOS_BUILT_DAY === 'unknown' ? '未注入' : PHYSICSOS_BUILT_DAY
  return `${PHYSICSOS_VERSION} · ${day}`
}
