/**
 * Free-build bench panel.
 *
 * The authoring half of the Lab: a parts palette, the list of what has been
 * placed, the wiring gestures' readout, and undo/redo. Every edit is a pure
 * draft transform handed to the runtime, which re-solves; this file holds only
 * the student's transient UI state (what is selected, what the next placement
 * will be), never a second copy of the circuit.
 *
 * Wires are drawn on the canvas by dragging one terminal onto another, so this
 * panel deliberately offers no "connect" form: the gesture is the feature.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { clsxJoin } from './primitives.tsx'
import {
  BUILDER_PARTS,
  disconnectTerminal,
  moveComponent,
  removeComponent,
  rotateComponent,
  setParams,
  type BuilderComponent,
  type BuilderPartSpec,
  type CircuitDraft,
  type TerminalRef,
} from './circuit-builder.ts'
import {
  CIRCUIT_METER_KINDS,
  TERMINAL_LABELS,
  ratingOfParams,
  spriteIdFor,
} from './circuit-builder-labels.ts'
import { PARTS3D, part3dUrl } from './parts3d-catalog.ts'
import { CIRCUIT_PART_MIME, duplicateBuilderComponent, placeBuilderPart } from './circuit-part-drag.ts'
import { parseCircuitDraft } from './workbench-history-codec.ts'
import css from './CircuitBuilderPanel.module.css'
import type { PhysicsosKey } from '../locales.ts'

type Translate = (key: PhysicsosKey) => string
type EditOutcome = boolean | Promise<boolean>
type FieldCommitOutcome = void | boolean | Promise<void | boolean>

/** Edits the panel can apply; every one is a pure draft transform. */
export interface BuilderEditing {
  readonly apply: (edit: (draft: CircuitDraft) => CircuitDraft) => void | Promise<void>
  readonly undo: () => void
  readonly redo: () => void
  readonly canUndo: boolean
  readonly canRedo: boolean
}

export interface CircuitBuilderPanelProps {
  readonly t: Translate
  readonly draft: CircuitDraft
  readonly editing: BuilderEditing
  /**
   * Terminal awaiting its partner in the wiring gesture, if any. The panel
   * echoes it so a half-finished connection is visible off-canvas too.
   */
  readonly pendingTerminal?: TerminalRef | undefined
  /** Whether the current draft solves; drives the readout tone, not the edit. */
  readonly solvable: boolean
  /** Optional shared selection connects the shelf inspector to canvas body presses. */
  readonly selectedComponentId?: string | undefined
  readonly onSelectComponent?: ((id: string | undefined) => void) | undefined
  readonly variant?: 'default' | 'compact'
}

const PART_GROUPS = [
  { key: 'power', types: ['voltage_source'] },
  { key: 'control', types: ['switch', 'variable_resistor'] },
  { key: 'loads', types: ['resistor'] },
  { key: 'meters', types: ['ammeter', 'voltmeter'] },
] as const

/** A numeric field that commits on blur/Enter rather than per keystroke, so a
    half-typed number never becomes a physical value. */
function NumberField({
  label,
  unit,
  value,
  onCommit,
  testId,
}: {
  readonly label: string
  readonly unit: string
  readonly value: number
  readonly onCommit: (next: number) => FieldCommitOutcome
  readonly testId: string
}) {
  const [text, setText] = useState(String(value))
  const [lastValue, setLastValue] = useState(value)
  const committedValue = useRef(value)
  committedValue.current = value
  const latestAttempt = useRef(0)
  const dirtyAttempt = useRef<number | undefined>()
  const submissions = useRef<{ attempt: number; value: number; settled: boolean }[]>([])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  /* Re-seed when the value changes underneath (undo, or a switch of part). */
  if (value !== lastValue) {
    const acknowledgement = submissions.current.find(submission => submission.value === value)
    const newerDraft = acknowledgement !== undefined && dirtyAttempt.current !== undefined &&
      dirtyAttempt.current > acknowledgement.attempt
    if (acknowledgement !== undefined) {
      submissions.current = submissions.current.filter(submission => submission !== acknowledgement &&
        (!submission.settled || submission.attempt > acknowledgement.attempt))
    }
    setLastValue(value)
    if (!newerDraft) {
      dirtyAttempt.current = undefined
      setText(String(value))
    }
  }
  const commit = (): void => {
    const attempt = ++latestAttempt.current
    const restore = (): void => {
      if (mounted.current && attempt === latestAttempt.current) {
        dirtyAttempt.current = undefined
        setText(String(committedValue.current))
      }
    }
    const parsed = Number(text)
    if (text.trim().length === 0 || !Number.isFinite(parsed)) {
      restore()
      return
    }
    const submission = { attempt, value: parsed, settled: false }
    submissions.current.push(submission)
    dirtyAttempt.current = attempt
    const settle = (accepted: void | boolean): void => {
      if (accepted === false) {
        submissions.current = submissions.current.filter(item => item !== submission)
        restore()
      } else {
        submission.settled = true
        // A resolved request may publish its prop on the next render; keep its marker until observed.
        if (committedValue.current === submission.value) {
          submissions.current = submissions.current.filter(item => item !== submission)
          if (dirtyAttempt.current === attempt) dirtyAttempt.current = undefined
        }
      }
    }
    let result: FieldCommitOutcome
    try { result = onCommit(parsed) } catch { settle(false); return }
    if (result === undefined || typeof result === 'boolean') {
      settle(result)
    } else {
      void result.then((accepted) => { settle(accepted) }, () => { settle(false) })
    }
  }
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{label}</span>
      <span className={css.fieldInput}>
        <input
          type="number"
          inputMode="decimal"
          data-testid={testId}
          value={text}
          onChange={(event) => {
            latestAttempt.current += 1
            dirtyAttempt.current = latestAttempt.current
            setText(event.target.value)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
        <span className={css.fieldUnit}>{unit}</span>
      </span>
    </label>
  )
}

/** The value fields a kind actually carries. */
function ParamsFor({
  t,
  component,
  onCommit,
}: {
  readonly t: Translate
  readonly component: BuilderComponent
  readonly onCommit: (params: Parameters<typeof setParams>[2]) => EditOutcome
}) {
  const params = component.params
  switch (component.type) {
    case 'voltage_source':
      return (
        <>
          <NumberField
            label={t('lab.builder.field.voltage')}
            unit="V"
            value={params.voltage ?? 6}
            testId={`builder-voltage-${component.id}`}
            onCommit={(next) => {
              return onCommit({ voltage: next })
            }}
          />
          <NumberField
            label={t('lab.builder.field.internalResistance')}
            unit="Ω"
            value={params.internalResistance ?? 0}
            testId={`builder-internal-${component.id}`}
            onCommit={(next) => {
              return onCommit({ internalResistance: next })
            }}
          />
        </>
      )
    case 'resistor':
      return (
        <NumberField
          label={t('lab.builder.field.resistance')}
          unit="Ω"
          value={params.resistance ?? 10}
          testId={`builder-resistance-${component.id}`}
          onCommit={(next) => {
            return onCommit({ resistance: next })
          }}
        />
      )
    case 'variable_resistor':
      return (
        <NumberField
          label={t('lab.builder.field.totalResistance')}
          unit="Ω"
          value={params.totalResistance ?? 20}
          testId={`builder-total-${component.id}`}
          onCommit={(next) => {
            return onCommit({ totalResistance: next })
          }}
        />
      )
    case 'ammeter':
    case 'voltmeter':
      return (
        <NumberField
          label={t('lab.builder.field.internalResistance')}
          unit="Ω"
          value={params.internalResistance ?? 0}
          testId={`builder-internal-${component.id}`}
          onCommit={(next) => {
            return onCommit({ internalResistance: next })
          }}
        />
      )
    case 'switch':
      return (
        <div className={css.choice} role="group" aria-label={t('lab.builder.field.state')}>
          <span className={css.fieldLabel}>{t('lab.builder.field.state')}</span>
          <div className={css.choiceRow}>
            {(['closed', 'open'] as const).map(state => (
              <button
                key={state}
                type="button"
                className={css.choiceButton}
                aria-pressed={(params.state ?? 'closed') === state}
                data-testid={`builder-state-${component.id}-${state}`}
                onClick={() => {
                  void onCommit({ state })
                }}
              >
                {state === 'closed' ? t('lab.builder.state.closed') : t('lab.builder.state.open')}
              </button>
            ))}
          </div>
        </div>
      )
    default:
      return null
  }
}

/** The photographed part itself, so the shelf reads as the equipment tray. */
function PartThumbnail({ sprite }: { readonly sprite: string }) {
  const part = PARTS3D[sprite]
  if (part === undefined) return null
  return (
    <img
      className={css.partShot}
      src={part3dUrl(part)}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="lazy"
    />
  )
}

/**
 * Render the free-build bench.
 *
 * Reuses the Lab's panel chrome so the bench reads as the same surface as the
 * scene tree it replaces, not as a new kind of screen.
 */
export function CircuitBuilderPanel({
  t,
  draft,
  editing,
  pendingTerminal,
  solvable,
  selectedComponentId,
  onSelectComponent,
  variant = 'default',
}: CircuitBuilderPanelProps) {
  const [localSelected, setLocalSelected] = useState<string | undefined>(undefined)
  const controlled = onSelectComponent !== undefined || selectedComponentId !== undefined
  const selected = controlled ? selectedComponentId : localSelected
  const latestEdit = useRef(0)
  const observedSelection = useRef(selected)
  if (observedSelection.current !== selected) {
    observedSelection.current = selected
    latestEdit.current += 1
  }
  const select = (id: string | undefined): void => {
    latestEdit.current += 1
    if (onSelectComponent !== undefined) onSelectComponent(id)
    else if (!controlled) setLocalSelected(id)
  }
  const [applying, setApplying] = useState(false)
  const [editFailed, setEditFailed] = useState(false)
  const mounted = useRef(true)
  const pendingEdits = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  /** Keep synchronous Lab edits synchronous; queued canvas edits select only after settlement. */
  const apply = (edit: (draft: CircuitDraft) => CircuitDraft, after?: () => void): EditOutcome => {
    const attempt = ++latestEdit.current
    let transformAccepted = false
    pendingEdits.current += 1
    setApplying(true)
    setEditFailed(false)
    const finish = (success: boolean): boolean => {
      pendingEdits.current -= 1
      if (!mounted.current) return success
      if (attempt === latestEdit.current) {
        setEditFailed(!success)
        if (success) after?.()
      }
      setApplying(pendingEdits.current > 0)
      return success
    }
    let result: void | Promise<void>
    try {
      result = editing.apply((current) => {
        transformAccepted = false
        try {
          const next = edit(current)
          if (parseCircuitDraft(next) === undefined) throw new TypeError('Invalid circuit authoring facts.')
          transformAccepted = true
          return next
        } catch (error: unknown) { transformAccepted = false; throw error }
      })
    } catch { return finish(false) }
    return result === undefined ? finish(transformAccepted) : result.then(() => finish(transformAccepted), () => finish(false))
  }
  const selectedComponent = useMemo(
    () => draft.components.find(component => component.id === selected),
    [draft, selected],
  )

  const partButton = (part: BuilderPartSpec) => (
    <button key={part.id} type="button" className={css.part} data-testid={`builder-add-${part.id}`}
      disabled={applying} draggable={!applying}
      onDragStart={(event) => {
        if (applying) { event.preventDefault(); return }
        event.stopPropagation()
        event.dataTransfer.setData(CIRCUIT_PART_MIME, part.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => {
        let placedId: string | undefined
        void apply((current) => {
          const added = placeBuilderPart(current, part)
          placedId = added.componentId
          return added.draft
        }, () => { if (placedId !== undefined) select(placedId) })
      }}>
      <PartThumbnail sprite={spriteIdFor(part.type, ratingOfParams(part.type, part.params), part.params.state !== 'open')} />
      <span className={css.partLabel}>{t(`lab.builder.part.${part.id}` as PhysicsosKey)}</span>
      {CIRCUIT_METER_KINDS.includes(part.type) ? <span className={css.partNote}>{t('lab.builder.part.ideal')}</span> : null}
    </button>
  )

  return (
    <div className={clsxJoin(css.builder, variant === 'compact' ? css.compact : undefined)} data-testid="circuit-builder" data-builder-variant={variant} aria-busy={applying}>
      {editFailed && selectedComponent === undefined ? <p className={css.editFeedback} role="alert">{t('lab.builder.editFailed')}</p> : null}
      <section className={css.section}>
        <h4 className={css.heading}>{t('lab.builder.parts')}</h4>
        {variant === 'compact' ? <div className={css.paletteGroups}>{PART_GROUPS.map(group => <section key={group.key} className={css.paletteGroup}>
          <h5 className={css.groupHeading}>{t(`lab.builder.group.${group.key}`)}</h5>
          <div className={css.palette}>
            {BUILDER_PARTS.filter(part => (group.types as readonly string[]).includes(part.type)).map(partButton)}
          </div>
          {group.key === 'power' ? <p className={css.hint}>{t('lab.builder.powerHint')}</p> : null}
        </section>)}</div> : <div className={css.palette}>{BUILDER_PARTS.map(partButton)}</div>}
        <p className={css.hint}>{t('lab.builder.placeHint')}</p>
      </section>

      <section className={css.section}>
        <h4 className={css.heading}>
          {t('lab.builder.placed')}
          <span className={css.count}>{draft.components.length}</span>
        </h4>
        {draft.components.length === 0 ? (
          <p className={css.empty}>{t('lab.builder.empty')}</p>
        ) : (
          <ul className={css.list}>
            {draft.components.map((component) => {
              const terminals = Object.keys(component.nets)
              return (
                <li key={component.id}>
                  <button
                    type="button"
                    className={css.row}
                    aria-pressed={selected === component.id}
                    data-testid={`builder-row-${component.id}`}
                    disabled={applying}
                    onClick={() => {
                      select(selected === component.id ? undefined : component.id)
                    }}
                  >
                    <span className={css.rowId}>{component.id}</span>
                    <span className={css.rowKind}>
                      {t(`lab.builder.part.${component.type}`)}
                    </span>
                    <span className={css.rowNets} aria-hidden="true">
                      {terminals.map(key => (
                        <span key={key} className={css.net}>
                          {TERMINAL_LABELS[key] ?? key}
                          {component.nets[key]}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {selectedComponent === undefined ? null : (
        <section className={clsxJoin(css.section, css.selectedSection)} data-testid={`builder-inspector-${selectedComponent.id}`}>
          <h4 className={css.heading}>
            {t('lab.builder.selected')}
            <span className={css.count}>{selectedComponent.id}</span>
          </h4>
          {editFailed ? <p className={css.editFeedback} role="alert">{t('lab.builder.editFailed')}</p> : null}
          <div className={css.fields}>
            <ParamsFor
              key={selectedComponent.id}
              t={t}
              component={selectedComponent}
              onCommit={(params) => {
                return apply(current => setParams(current, selectedComponent.id, params))
              }}
            />
          </div>
          <div className={css.actions}>
            <button
              type="button"
              className={css.action}
              data-testid={`builder-rotate-${selectedComponent.id}`}
              disabled={applying}
              onClick={() => {
                void apply(current => rotateComponent(current, selectedComponent.id))
              }}
            >
              {t('lab.builder.rotate')}
            </button>
            <button
              type="button"
              className={css.action}
              data-testid={`builder-copy-${selectedComponent.id}`}
              disabled={applying || selectedComponent.type === 'voltage_source'}
              title={selectedComponent.type === 'voltage_source' ? t('lab.builder.powerHint') : undefined}
              onClick={() => {
                let copiedId: string | undefined
                void apply((current) => {
                  const copied = duplicateBuilderComponent(current, selectedComponent.id)
                  if (copied === undefined) return current
                  copiedId = copied.componentId
                  return copied.draft
                }, () => { if (copiedId !== undefined) select(copiedId) })
              }}
            >
              {t('lab.builder.copy')}
            </button>
            <button
              type="button"
              className={css.action}
              data-testid={`builder-nudge-${selectedComponent.id}`}
              disabled={applying}
              onClick={() => {
                void apply(current =>
                  moveComponent(current, selectedComponent.id, {
                    x: selectedComponent.placement.x + 1,
                    y: selectedComponent.placement.y,
                  }),
                )
              }}
            >
              {t('lab.builder.nudge')}
            </button>
            <button
              type="button"
              className={clsxJoin(css.action, css.danger)}
              data-testid={`builder-remove-${selectedComponent.id}`}
              disabled={applying}
              onClick={() => {
                void apply(current => removeComponent(current, selectedComponent.id), () => { select(undefined) })
              }}
            >
              {t('lab.builder.remove')}
            </button>
          </div>
          <div className={css.terminalActions}>
            {Object.entries(selectedComponent.nets).map(([terminalKey, net]) => {
              const connected = draft.components.reduce(
                (count, component) => count + Object.values(component.nets).filter(value => value === net).length,
                0,
              ) > 1
              return <button key={terminalKey} type="button" className={css.action} disabled={applying || !connected}
                data-testid={`builder-disconnect-${selectedComponent.id}-${terminalKey}`}
                onClick={() => { void apply(current => disconnectTerminal(current, { componentId: selectedComponent.id, terminalKey })) }}>
                {t('lab.builder.disconnect').replace('{terminal}', TERMINAL_LABELS[terminalKey] ?? terminalKey)}
              </button>
            })}
          </div>
        </section>
      )}

      <section className={clsxJoin(css.section, css.footer)}>
        <div className={css.history}>
          <button
            type="button"
            className={css.action}
            disabled={applying || !editing.canUndo}
            data-testid="builder-undo"
            onClick={() => { latestEdit.current += 1; editing.undo() }}
          >
            {t('lab.builder.undo')}
          </button>
          <button
            type="button"
            className={css.action}
            disabled={applying || !editing.canRedo}
            data-testid="builder-redo"
            onClick={() => { latestEdit.current += 1; editing.redo() }}
          >
            {t('lab.builder.redo')}
          </button>
        </div>
        <p
          className={clsxJoin(css.status, solvable ? undefined : css.statusOpen)}
          data-testid="builder-status"
          role="status"
        >
          {pendingTerminal === undefined
            ? solvable
              ? t('lab.builder.solves')
              : t('lab.builder.unfinished')
            : t('lab.builder.awaiting')
              .replace('{id}', pendingTerminal.componentId)
              .replace(
                '{terminal}',
                TERMINAL_LABELS[pendingTerminal.terminalKey] ?? pendingTerminal.terminalKey,
              )}
        </p>
      </section>
    </div>
  )
}
