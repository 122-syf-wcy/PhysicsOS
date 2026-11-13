import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { CanvasLayout, CanvasViewport } from '@physicsos/physics-workbench/types'
import type { PhysicsosKey } from '../locales.ts'

export interface CanvasViewState {
  canvasId: string | undefined
  selected: string[]
  focusedInstanceKey: string | undefined
  tool: 'select' | 'hand' | 'pen' | 'line' | 'rectangle' | 'ellipse' | 'eraser'
  sidebar: 'parameters' | 'objects' | 'results'
  libraryOpen: boolean
  pendingSourceKey: string | undefined
  catalogSearch: string
  catalogSort: 'updated' | 'created' | 'title'
  showDeleted: boolean
  transientLayouts: Record<string, CanvasLayout>
  transientViewport: CanvasViewport | undefined
  toast: { id: number; key: PhysicsosKey; message?: string; error: boolean } | undefined
}

/** Shared viewing state survives surface remounts; documents and runtimes stay in their model owners. */
export function createCanvasViewStore() {
  return defineStore({
    init: (): CanvasViewState => ({
      canvasId: undefined,
      selected: [],
      focusedInstanceKey: undefined,
      tool: 'select',
      sidebar: 'parameters',
      libraryOpen: false,
      pendingSourceKey: undefined,
      catalogSearch: '',
      catalogSort: 'updated',
      showDeleted: false,
      transientLayouts: {},
      transientViewport: undefined,
      toast: undefined,
    }),
    actions: {
      chooseCanvas(state: CanvasViewState, id: string | undefined) {
        state.canvasId = id
        state.selected = []
        state.focusedInstanceKey = undefined
        state.transientLayouts = {}
        state.transientViewport = undefined
        state.libraryOpen = false
      },
      select(state: CanvasViewState, ids: readonly string[]) { state.selected = [...ids] },
      focus(state: CanvasViewState, key: string | undefined) { state.focusedInstanceKey = key },
      setTool(state: CanvasViewState, tool: CanvasViewState['tool']) { state.tool = tool },
      setSidebar(state: CanvasViewState, sidebar: CanvasViewState['sidebar']) { state.sidebar = sidebar },
      setLibraryOpen(state: CanvasViewState, open: boolean) { state.libraryOpen = open },
      setPendingSourceKey(state: CanvasViewState, key: string | undefined) { state.pendingSourceKey = key },
      setCatalogSearch(state: CanvasViewState, value: string) { state.catalogSearch = value },
      setCatalogSort(state: CanvasViewState, value: CanvasViewState['catalogSort']) { state.catalogSort = value },
      setShowDeleted(state: CanvasViewState, value: boolean) { state.showDeleted = value },
      previewLayout(state: CanvasViewState, id: string, layout: CanvasLayout) { state.transientLayouts[id] = layout },
      previewLayouts(state: CanvasViewState, layouts: Readonly<Record<string, CanvasLayout>>) {
        state.transientLayouts = { ...state.transientLayouts, ...layouts }
      },
      clearGesture(state: CanvasViewState) { state.transientLayouts = {}; state.transientViewport = undefined },
      clearGestureIf(state: CanvasViewState, layouts: Readonly<Record<string, CanvasLayout>> | undefined, viewport: CanvasViewport | undefined) {
        for (const [id, completed] of Object.entries(layouts ?? {})) {
          const current = state.transientLayouts[id]
          if (current !== undefined && current.x === completed.x && current.y === completed.y && current.width === completed.width && current.height === completed.height && current.zIndex === completed.zIndex) {
            delete state.transientLayouts[id]
          }
        }
        const current = state.transientViewport
        if (current !== undefined && viewport !== undefined && current.x === viewport.x && current.y === viewport.y && current.zoom === viewport.zoom) state.transientViewport = undefined
      },
      previewViewport(state: CanvasViewState, viewport: CanvasViewport) { state.transientViewport = viewport },
      showToast(state: CanvasViewState, key: PhysicsosKey, message: string | undefined, error = false) {
        state.toast = { id: (state.toast?.id ?? 0) + 1, key, error, ...(message === undefined ? {} : { message }) }
      },
      clearToast(state: CanvasViewState, id: number) { if (state.toast?.id === id) state.toast = undefined },
    },
  })
}
