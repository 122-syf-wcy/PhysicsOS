import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'

const base = clientBundle('@deepseek-ai/dsh-client-ui-physicsos', ['lib/types/index.js', 'lib/types/invariant.js'])

/**
 * 版本戳 —— 界面显示「0.1.0 · 构建于 …」。这是第 5 期里**纯 Web 也需要**的
 * 那一项:用户报障时一句「我这里是 0.1.0」比一张截图有用得多,且不需要任何
 * 服务端配合。
 *
 * 两个常量在**构建期**被替换成字面量,运行时零开销。版本取自仓库根
 * package.json(唯一真源),构建时间取本次构建时刻;时间戳是排障定位信息,
 * 不是语义版本的一部分。
 */
const version = JSON.parse(
  readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8'),
).version as string
const builtAt = new Date()
/* 构建日期在**构建机本地时间**算好再注入。让浏览器各自按读者时区去格式化同一个
   时刻,会让不同时区的人看到同一个包的两个「构建日」—— 而这是产物的属性,不是
   读者的属性。 */
const builtDay = [
  builtAt.getFullYear(),
  String(builtAt.getMonth() + 1).padStart(2, '0'),
  String(builtAt.getDate()).padStart(2, '0'),
].join('-')

/**
 * question-upload.ts loads pdf.js through `import()` so jsdom tests and
 * image-only sessions never evaluate it. The client artifact must stay ONE
 * file: the loader's require only resolves the module table (plugin ids),
 * never relative emitted chunks — so dynamic imports fold back into
 * client.js and still evaluate lazily.
 */
export default (inlineConfig: Pick<UserConfig, 'env'>): UserConfig[] =>
  base(inlineConfig).map((config) => {
    if (!String(config.name ?? '').endsWith('/client')) return config
    return {
      ...config,
      define: {
        ...config.define,
        __PHYSICSOS_VERSION__: JSON.stringify(version),
        __PHYSICSOS_BUILT_AT__: JSON.stringify(builtAt.toISOString()),
        __PHYSICSOS_BUILT_DAY__: JSON.stringify(builtDay),
      },
      outputOptions: { ...config.outputOptions, inlineDynamicImports: true },
    }
  })
