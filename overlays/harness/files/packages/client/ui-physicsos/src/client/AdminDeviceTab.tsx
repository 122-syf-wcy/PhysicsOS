/**
 * 设备 tab — 第 4 期服务端半的界面:登记过的设备 + 远程注销 + 风控信号。
 *
 * 三件事在这一屏上必须同时在,而且各自说清自己是什么:
 *
 *   - **设备列表**:每行是一台机器在一个账号下的登记。展示的是**哈希**,不是
 *     序列号 —— 客户端本来就只上传哈希。
 *   - **远程注销**:可直接撤销,也可恢复。超管发的注销是**平台级**(对所有学校
 *     生效),校管理员发的只影响本校;界面把这件事写出来,免得校管理员点了恢复
 *     却不知道为什么没生效(见 `revokedGlobally`)。
 *   - **风控信号**:只出计数,没有 IP。文案说清这是「记录与展示」,不是自动封
 *     禁 —— 界面不该让一次换电脑登录读起来像一次入侵。
 *
 * 这一屏**没有**任何「未登记设备不能登录」的表达:用户定过不做一机一码锁死,
 * 设备登记是增项而不是门槛。
 */
import { useCallback, useEffect, useState } from 'react'

import type { AdminApi, DeviceRow, RiskSignalRow } from './auth-api.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './AdminWorkspace.module.css'

export interface AdminDeviceTabProps {
  readonly api: AdminApi
  readonly isSuper: boolean
  readonly t: (key: PhysicsosKey) => string
}

/** `2026-09-25T02:11:03.000Z` → `09-25 10:11` in the reader's own timezone. */
const stamp = (iso: string): string => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** 哈希展示成前 12 位 + 省略号:够区分两台机器,又不把整屏塞满。 */
const shortId = (id: string): string => (id.length <= 16 ? id : `${id.slice(0, 12)}…`)

export function AdminDeviceTab({ api, isSuper, t }: AdminDeviceTabProps) {
  const [rows, setRows] = useState<DeviceRow[] | undefined>(undefined)
  const [risk, setRisk] = useState<RiskSignalRow[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.listDevices(query === '' ? undefined : { q: query })
      setRows(data.devices)
      setRisk(data.risk)
      setError(undefined)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [api, query])

  useEffect(() => { void load() }, [load])

  const toggle = async (row: DeviceRow): Promise<void> => {
    setBusy(row.deviceId)
    try {
      await api.setDeviceRevoked(row.deviceId, !row.revoked)
      await load()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
    setBusy(undefined)
  }

  if (error !== undefined && rows === undefined) {
    return <p className={css.error}>{error}</p>
  }
  if (rows === undefined) {
    return <p className={css.cardMeta}>{t('admin.loading')}</p>
  }

  return (
    <div className={css.list}>
      {error !== undefined && <p className={css.error}>{error}</p>}

      <section className={css.card}>
        <h3 className={css.cardTitle}>{t('admin.devices.title')}</h3>
        <p className={css.cardMeta}>{t('admin.devices.hint')}</p>
        <div className={css.formRow}>
          <input
            className={css.input}
            data-testid="device-search"
            placeholder={t('admin.devices.search')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>
      </section>

      <section className={css.card} data-testid="device-list">
        {rows.length === 0
          ? <p className={css.cardMeta}>{t('admin.devices.empty')}</p>
          : (
            <table className={css.deviceTable}>
              <thead>
                <tr>
                  <th>{t('admin.devices.col.device')}</th>
                  {isSuper && <th>{t('admin.devices.col.school')}</th>}
                  <th>{t('admin.devices.col.user')}</th>
                  <th>{t('admin.devices.col.seen')}</th>
                  <th>{t('admin.devices.col.state')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} data-device={row.deviceId}
                    data-revoked={row.revoked ? 'true' : 'false'}>
                    <td title={row.deviceId}>
                      <code>{shortId(row.deviceId)}</code>
                      {row.platform !== undefined && (
                        <span className={css.cardMeta}> · {row.platform}</span>
                      )}
                    </td>
                    {isSuper && <td>{row.schoolId}</td>}
                    <td>{row.username}</td>
                    <td>
                      {stamp(row.lastSeenAt)}
                      <span className={css.cardMeta}>{` · ${String(row.seenCount)}×`}</span>
                    </td>
                    <td>
                      {row.revoked
                        ? (
                          <span className={css.badgeRevoked}>
                            {row.revokedGlobally
                              ? t('admin.devices.state.global')
                              : t('admin.devices.state.local')}
                          </span>
                        )
                        : <span className={css.badgeActive}>{t('admin.devices.state.active')}</span>}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={row.revoked ? css.primary : css.danger}
                        data-testid={`device-toggle-${row.deviceId}`}
                        disabled={busy === row.deviceId}
                        onClick={() => { void toggle(row) }}
                      >
                        {busy === row.deviceId
                          ? t('admin.loading')
                          : row.revoked
                            ? t('admin.devices.restore')
                            : t('admin.devices.revoke')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>

      <section className={css.card} data-testid="device-risk">
        <h3 className={css.cardTitle}>{t('admin.devices.risk.title')}</h3>
        <p className={css.cardMeta}>{t('admin.devices.risk.hint')}</p>
        {risk.length === 0
          ? <p className={css.cardMeta}>{t('admin.devices.risk.empty')}</p>
          : (
            <ul>
              {risk.map(signal => (
                <li key={`${signal.kind}:${signal.subject}`} data-risk={signal.kind}>
                  {t(signal.kind === 'account-multi-device'
                    ? 'admin.devices.risk.account'
                    : 'admin.devices.risk.device')
                    .replace('{subject}', shortId(signal.subject))
                    .replace('{count}', String(signal.count))
                    .replace('{hours}', String(Math.round(signal.windowMs / 3_600_000)))}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
