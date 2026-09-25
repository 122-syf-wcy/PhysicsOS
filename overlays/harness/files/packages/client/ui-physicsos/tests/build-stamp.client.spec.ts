// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  PHYSICSOS_BUILT_AT, PHYSICSOS_BUILT_DAY, PHYSICSOS_VERSION, buildStamp,
} from '../src/client/build-stamp.ts'

/**
 * 版本戳的 spec —— 它要证明的是一件容易做错的事:**没注入时也不能炸**。
 *
 * 构建产物把两个常量替换成字面量;但单元测试跑在源码上、没有 tsdown 的
 * `define`,所以这里看到的正是「未注入」分支。如果实现写成直接引用常量,
 * 这个文件会 ReferenceError —— 也就是说它守的是「版本号不该让界面起不来」。
 */
describe('build-stamp', () => {
  it('falls back instead of throwing when the build did not inject a stamp', () => {
    expect(PHYSICSOS_VERSION).toBe('dev')
    expect(PHYSICSOS_BUILT_AT).toBe('unknown')
  })

  it('takes the build day from the build, not from the reader timezone', () => {
    /* 构建日是产物的属性。如果实现改成在浏览器里格式化 `PHYSICSOS_BUILT_AT`,
       不同时区的人会看到同一个包的两个「构建日」—— 这里读的是构建期注入值。 */
    expect(PHYSICSOS_BUILT_DAY).toBe('unknown')
  })

  it('renders one short line, and says so when there is no build date', () => {
    /* 报障时读的就是这一行,所以它必须短、单行、且在没有日期时仍然可读。 */
    const line = buildStamp()
    expect(line).toBe('dev · 未注入')
    expect(line).not.toContain('\n')
  })
})
