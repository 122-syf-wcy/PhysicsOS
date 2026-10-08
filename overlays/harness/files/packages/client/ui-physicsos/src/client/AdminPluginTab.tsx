/**
 * SUPER_ADMIN plugin catalog. This surface manages only the preinstalled,
 * source-controlled catalog; installation is deliberately not a capability.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import type {
  PluginCenterApi,
  PluginCenterEntry,
  PluginCenterState,
  PluginCompatibility,
  PluginSource,
} from './PluginCenterApi.ts'
import type { PhysicsosKey } from './locales.ts'
import { GlassSelect } from './GlassSelect.tsx'
import {
  AdminCard,
  AdminCardHead,
  AdminCardMeta,
  AdminCardTitle,
  AdminEmpty,
  AdminTable,
  AdminToolbar,
} from './AdminPrimitives.tsx'
import css from './AdminWorkspace.module.css'

export interface AdminPluginTabProps {
  readonly api: PluginCenterApi
  readonly t: (key: PhysicsosKey) => string
}

type SourceFilter = 'all' | PluginSource

const SOURCE_TITLE: Record<PluginSource, PhysicsosKey> = {
  official: 'admin.plugins.source.official',
  physicsos: 'admin.plugins.source.physicsos',
}

const COMPATIBILITY_LABEL: Record<PluginCompatibility, PhysicsosKey> = {
  compatible: 'admin.plugins.compatibility.compatible',
  incompatible: 'admin.plugins.compatibility.incompatible',
  unknown: 'admin.plugins.compatibility.unknown',
}

const STATUS_LABEL: Record<PluginCenterEntry['status'], PhysicsosKey> = {
  enabled: 'admin.plugins.status.enabled',
  disabled: 'admin.plugins.status.disabled',
  failed: 'admin.plugins.status.failed',
}

const CAPABILITY_LABEL: Record<string, PhysicsosKey> = {
  'filesystem.workspace.read': 'admin.plugins.capability.filesystem.workspace.read',
  'filesystem.workspace.write': 'admin.plugins.capability.filesystem.workspace.write',
  'model.invoke': 'admin.plugins.capability.model.invoke',
  'network.http': 'admin.plugins.capability.network.http',
  'network.postgresql': 'admin.plugins.capability.network.postgresql',
  'network.redis': 'admin.plugins.capability.network.redis',
  'process.document': 'admin.plugins.capability.process.document',
  'secrets.read': 'admin.plugins.capability.secrets.read',
  'session.observe': 'admin.plugins.capability.session.observe',
  'storage.read': 'admin.plugins.capability.storage.read',
  'storage.write': 'admin.plugins.capability.storage.write',
  'tools.register': 'admin.plugins.capability.tools.register',
  'ui.register': 'admin.plugins.capability.ui.register',
}

const canEnable = (entry: PluginCenterEntry): boolean =>
  entry.compatibility === 'compatible'
  && entry.integrity === 'verified'
  && entry.status !== 'failed'

const compatibilityClass = (
  compatibility: PluginCompatibility,
): string | undefined => compatibility === 'compatible' ? css.badgeActive : css.badgeRevoked

const statusClass = (status: PluginCenterEntry['status']): string | undefined => {
  if (status === 'enabled') return css.badgeActive
  if (status === 'failed') return css.badgeRevoked
  return css.action
}

function PluginGroup({
  source,
  entries,
  busy,
  onToggle,
  t,
}: {
  readonly source: PluginSource
  readonly entries: readonly PluginCenterEntry[]
  readonly busy: string | undefined
  readonly onToggle: (entry: PluginCenterEntry) => void
  readonly t: (key: PhysicsosKey) => string
}): ReactNode {
  return (
    <AdminCard testId={`plugin-group-${source}`} data-plugin-source={source}>
      <AdminCardHead>
        <div>
          <AdminCardTitle>{t(SOURCE_TITLE[source])}</AdminCardTitle>
          <AdminCardMeta>
            {t('admin.plugins.groupCount').replace('{count}', String(entries.length))}
          </AdminCardMeta>
        </div>
      </AdminCardHead>
      <AdminTable minWidth={760}>
        <thead>
          <tr>
            <th>{t('admin.plugins.col.plugin')}</th>
            <th>{t('admin.plugins.col.compatibility')}</th>
            <th>{t('admin.plugins.col.capabilities')}</th>
            <th>{t('admin.plugins.col.status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const enabling = entry.status === 'disabled'
            const disabled = busy !== undefined || (enabling && !canEnable(entry))
            return (
              <tr key={entry.id} data-plugin-id={entry.id}>
                <td>
                  <strong>{entry.name}</strong>
                  <AdminCardMeta>
                    {entry.publisher}
                    {' · '}
                    v{entry.version}
                    {' · '}
                    {entry.harnessRange}
                  </AdminCardMeta>
                  {entry.description === undefined ? null : (
                    <p className={css.cardText}>{entry.description}</p>
                  )}
                  <code>{entry.id}</code>
                </td>
                <td>
                  <span className={compatibilityClass(entry.compatibility)}>
                    {t(COMPATIBILITY_LABEL[entry.compatibility])}
                  </span>
                  <AdminCardMeta>
                    {entry.integrity === 'verified'
                      ? t('admin.plugins.integrity.verified')
                      : t('admin.plugins.integrity.missing')}
                  </AdminCardMeta>
                </td>
                <td>
                  {entry.capabilities.length === 0
                    ? <AdminCardMeta>{t('admin.plugins.capabilities.none')}</AdminCardMeta>
                    : (
                      <ul className={css.cardMeta}>
                        {entry.capabilities.map(capability => (
                          <li key={capability}>
                            <code>{capability}</code>
                            {' · '}
                            {CAPABILITY_LABEL[capability] === undefined
                              ? capability
                              : t(CAPABILITY_LABEL[capability])}
                          </li>
                        ))}
                      </ul>
                    )}
                </td>
                <td>
                  <span
                    className={statusClass(entry.status)}
                    data-testid={`plugin-status-${entry.id}`}
                  >
                    {t(STATUS_LABEL[entry.status])}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className={enabling ? css.primary : css.ghost}
                    data-testid={`plugin-toggle-${entry.id}`}
                    disabled={disabled}
                    onClick={() => { onToggle(entry) }}
                  >
                    {enabling ? t('admin.plugins.enable') : t('admin.plugins.disable')}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </AdminTable>
    </AdminCard>
  )
}

export function AdminPluginTab({ api, t }: AdminPluginTabProps): ReactNode {
  const [state, setState] = useState<PluginCenterState | undefined>()
  const [source, setSource] = useState<SourceFilter>('all')
  const [busy, setBusy] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(() => {
    setError(undefined)
    api.state()
      .then(setState)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }, [api])

  useEffect(load, [load])

  const toggle = (entry: PluginCenterEntry): void => {
    const enabled = entry.status === 'disabled'
    if (enabled && !canEnable(entry)) return
    setBusy(entry.id)
    setError(undefined)
    api.setEnabled(entry.id, enabled)
      .then(({ entry: updated }) => {
        setState(current => current === undefined ? current : {
          ...current,
          entries: current.entries.map(candidate =>
            candidate.id === updated.id ? updated : candidate),
        })
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setBusy(undefined) })
  }

  if (state === undefined) {
    return error === undefined
      ? <AdminEmpty>{t('admin.loading')}</AdminEmpty>
      : <p className={css.error} role="alert">{error}</p>
  }

  const visible = source === 'all'
    ? state.entries
    : state.entries.filter(entry => entry.source === source)
  const official = visible.filter(entry => entry.source === 'official')
  const physicsos = visible.filter(entry => entry.source === 'physicsos')

  return (
    <>
      <AdminCard data-admin-plugin-center="">
        <AdminCardHead>
          <div>
            <AdminCardTitle>{t('admin.plugins.title')}</AdminCardTitle>
            <AdminCardMeta>{t('admin.plugins.hint')}</AdminCardMeta>
          </div>
          <AdminCardMeta>
            {t('admin.plugins.harnessVersion')
              .replace('{version}', state.pinnedHarnessVersion)}
          </AdminCardMeta>
        </AdminCardHead>
      </AdminCard>

      <AdminToolbar>
        <GlassSelect
          className={css.select}
          value={source}
          ariaLabel={t('admin.plugins.source.label')}
          testId="plugin-source-filter"
          options={[
            { value: 'all', label: t('admin.plugins.source.all') },
            { value: 'official', label: t('admin.plugins.source.official') },
            { value: 'physicsos', label: t('admin.plugins.source.physicsos') },
          ]}
          onChange={(next) => { setSource(next as SourceFilter) }}
        />
      </AdminToolbar>

      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      {visible.length === 0 && <AdminEmpty>{t('admin.plugins.empty')}</AdminEmpty>}
      {official.length === 0 ? null : (
        <PluginGroup source="official" entries={official} busy={busy} onToggle={toggle} t={t} />
      )}
      {physicsos.length === 0 ? null : (
        <PluginGroup source="physicsos" entries={physicsos} busy={busy} onToggle={toggle} t={t} />
      )}
    </>
  )
}
