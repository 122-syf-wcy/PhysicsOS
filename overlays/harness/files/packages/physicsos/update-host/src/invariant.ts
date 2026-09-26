/**
 * Package-owned durable invariants for physicsos_update.
 *
 * 两条关系,都是「不加检查就会悄悄错」的那种:
 *
 *   1. release 的 `channel|version` 必须与它的键一致。键是唯一性的载体
 *      (UNIQUE(channel, version)),一个键与内容不一致的行会让「发过没有」这个
 *      问题按哪一边回答都说得通。
 *   2. channels.activeVersion 若不为 null,它必须指向同一通道里一个存在且未撤回
 *      的 release。指针指空 / 指向已撤回版本,客户端会拿到 503 然后永远停在旧版
 *      上 —— 而写入侧看起来一切正常。
 *
 * 第二条要在**撤回**之后仍然成立,所以它检查的是 live 表而不仅是这一次的写入:
 * `yank` 先落 release 的 `yankedAt`,再把指针挪走,两条事件在同一个 tick 里先后
 * 到达,指针那条读到的已经是撤回后的行。
 * @module @deepseek-ai/dsh-update-host/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-update-host'
const DOMAIN = 'physicsos_update'

/** Cordis companion plugin name. */
export const name = 'update-host-invariant'
/**
 * Service required before the companion can reserve package ownership.
 *
 * `invariants` ONLY, matching every other package's companion — and for the
 * reason `paper-host/src/invariant.ts` records at length: a companion is
 * mounted inside the invariant startup barrier, so one that waits for a
 * Loader-managed service deadlocks the whole chain. The domain is reached
 * lazily inside {@link check} instead — by the time a `domain/changed` event
 * fires, the service exists.
 */
export const inject = ['invariants']

/** Re-check the durable relations after each change lands. */
const check = (ctx: Context, change: DomainChanged, fail: InvariantFailure): void => {
  if (change.domain !== DOMAIN) return
  const domain = ctx.storageDomain.get(DOMAIN)
  if (domain === undefined) return

  if (change.table === 'releases' && change.operation === 'put') {
    const row = change.value as { channel?: unknown; version?: unknown; id?: unknown }
    if (typeof row.channel !== 'string' || typeof row.version !== 'string') {
      fail(`releases['${change.key}'] is missing channel/version`)
      return
    }
    if (row.id !== `${row.channel}|${row.version}`) {
      fail(`releases['${change.key}'] id '${String(row.id)}' does not match channel|version `
        + `'${row.channel}|${row.version}'`)
    }
    return
  }

  if (change.table === 'channels' && change.operation === 'put') {
    const row = change.value as { name?: unknown; activeVersion?: unknown }
    if (typeof row.name !== 'string') {
      fail(`channels['${change.key}'] is missing name`)
      return
    }
    /* null 是合法值 —— 一个刚开通 / 被清空的通道就是这样。 */
    if (row.activeVersion === null) return
    if (typeof row.activeVersion !== 'string') {
      fail(`channels['${row.name}'] activeVersion must be a string or null`)
      return
    }
    const release = domain.table('releases').get(`${row.name}|${row.activeVersion}`) as
      { yankedAt?: unknown } | undefined
    if (release === undefined) {
      fail(`channels['${row.name}'] points at '${row.activeVersion}', which is not published`)
      return
    }
    if (release.yankedAt !== undefined) {
      fail(`channels['${row.name}'] points at '${row.activeVersion}', which is yanked`)
    }
  }
}

/** Install the relation checks on every domain change. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => { check(ctx, change, fail) })
}

/**
 * Register the update-domain invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
