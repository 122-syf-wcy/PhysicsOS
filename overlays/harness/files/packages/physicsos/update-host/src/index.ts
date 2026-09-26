/**
 * @deepseek-ai/dsh-update-host - the PhysicsOS 更新通道 host plugin.
 *
 * 方案第 5 期的服务端半:latest.json 托管 + 发布 / 回滚 / 撤回。
 *
 * 为什么它现在就能做、不用等证书:那两张证书(Apple Developer / Windows 代码
 * 签名)解决的是「下载时操作系统信不信这个安装包」。更新通道的验签用的是
 * minisign / Ed25519 密钥对,自己生成、自己保管,和操作系统证书无关。所以这里把
 * 「发布者登记产物 + 托管 Tauri updater 认的 latest.json」做完,证书到了只要把
 * 真签名过的安装包填进来。
 *
 * 读公开、写超管;身份服务在 auth-host 里,而本 host 声明在它之前,所以按请求
 * 惰性解析 —— 与 paper / notice 两个 host 同一条约定。
 *
 * @module @deepseek-ai/dsh-update-host
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { openUpdateDomain } from './domain.ts'
import { UpdateService } from './service.ts'
import { updateRoutes } from './routes.ts'
import { identityOf } from './identity.ts'

export const name = 'update-host'
export const inject = ['webServer', 'storageDomain']

/**
 * Plugin entry: open the update domain and serve /physicsos/update.
 * @param ctx - plugin context carrying webServer/storageDomain.
 * @returns the effect disposer (route unregisters, domain closes).
 */
export function apply(ctx: Context): () => Promise<void> {
  return ctx.effect(async function* () {
    const domain = await openUpdateDomain(ctx)
    const service = new UpdateService(domain)

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/update',
      handler: updateRoutes({
        service,
        identity: () => identityOf(ctx),
      }),
    })
    yield () => domain.close()
  }, 'update-host')
}
