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
import { CIRCUIT_PART_MIME, placeBuilderPart } from './circuit-part-drag.ts'
import css from './CircuitBuilderPanel.module.css'
import type { PhysicsosKey } from '../locales.ts'

type Translate = (key: PhysicsosKey) => string

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
  readonly onCommit: (next: number) => void
  readonly testId: string
}) {
  const [text, setText] = useState(String(value))
  const [lastValue, setLastValue] = useState(value)
  /* Re-seed when the value changes underneath (undo, or a switch of part). */
  if (value !== lastValue) {
    setLastValue(value)
    setText(String(value))
  }
  const commit = () => {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setText(String(value))
      return
    }
    onCommit(parsed)
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
  readonly onCommit: (params: Parameters<typeof setParams>[2]) => void
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
              onCommit({ voltage: next })
            }}
          />
          <NumberField
            label={t('lab.builder.field.internalResistance')}
            unit="Ω"
            value={params.internalResistance ?? 0}
            testId={`builder-internal-${component.id}`}
            onCommit={(next) => {
              onCommit({ internalResistance: next })
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
            onCommit({ resistance: next })
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
            onCommit({ totalResistance: next })
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
            onCommit({ internalResistance: next })
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
                  onCommit({ state })
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
  const select = (id: string | undefined): void => {
    if (onSelectComponent !== undefined) onSelectComponent(id)
    else if (!controlled) setLocalSelected(id)
  }
  const [applying, setApplying] = useState(false)
  const [editFailed, setEditFailed] = useState(false)
  const mounted = useRef(true)
  const pendingEdits = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  /** Keep synchronous Lab edits synchronous; queued canvas edits select only after settlement. */
  const apply = (edit: (draft: CircuitDraft) => CircuitDraft, after?: () => void): void => {
    pendingEdits.current += 1
    setApplying(true)
    setEditFailed(false)
    const finish = (success: boolean): void => {
      pendingEdits.current -= 1
      if (!mounted.current) return
      if (success) after?.()
      else setEditFailed(true)
      setApplying(pendingEdits.current > 0)
    }
    try {
      const result = editing.apply(edit)
      if (result === undefined) finish(true)
      else void result.then(() => { finish(true) }, () => { finish(false) })
    } catch { finish(false) }
  }
  const selectedComponent = useMemo(
    () => draft.components.find(component => component.id === selected),
    [draft, selected],
  )

  /* Placement search: drop the next part to the right of whatever is already
     there so a new part never lands on top of an existing one. */
  const nextSpot = useMemo(() => {
    if (draft.components.length === 0) return { x: 0, y: 0 }
    const rightmost = draft.components.reduce(
      (best, component) => (component.placement.x > best.placement.x ? component : best),
      draft.components[0] as BuilderComponent,
    )
    return {
      x: rightmost.placement.x + (rightmost.type === 'resistor' ? 3 : 4),
      y: rightmost.placement.y,
    }
  }, [draft.components])

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
        apply((current) => {
          const existingSource = part.type === 'voltage_source' && current.components.some(component => component.type === 'voltage_source')
          const added = placeBuilderPart(current, part, existingSource ? undefined : nextSpot)
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
          <div className={css.fields}>
            <ParamsFor
              t={t}
              component={selectedComponent}
              onCommit={(params) => {
                apply(current => setParams(current, selectedComponent.id, params))
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
                apply(current => rotateComponent(current, selectedComponent.id))
              }}
            >
              {t('lab.builder.rotate')}
            </button>
            <button
              type="button"
              className={css.action}
              data-testid={`builder-nudge-${selectedComponent.id}`}
              disabled={applying}
              onClick={() => {
                apply(current =>
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
                apply(current => removeComponent(current, selectedComponent.id), () => { select(undefined) })
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
                onClick={() => { apply(current => disconnectTerminal(current, { componentId: selectedComponent.id, terminalKey })) }}>
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
            onClick={editing.undo}
          >
            {t('lab.builder.undo')}
          </button>
          <button
            type="button"
            className={css.action}
            disabled={applying || !editing.canRedo}
            data-testid="builder-redo"
            onClick={editing.redo}
          >
            {t('lab.builder.redo')}
          </button>
        </div>
        {editFailed ? <p className={css.hint} role="alert">{t('lab.builder.editFailed')}</p> : null}
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
