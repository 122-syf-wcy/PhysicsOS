// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminPromptTab } from '../src/client/AdminPromptTab.tsx'
import {
  DeveloperPromptApiError,
  type DeveloperPromptApi,
  type PromptAdminView,
  type PromptDraftInput,
  type PromptImportInput,
} from '../src/client/developer-prompt-api.ts'
import { renderPrompt } from '../src/client/developer-prompt-format.ts'

const initial = (): PromptAdminView => ({
  revision: 0,
  draft: null,
  versions: [],
  bindingChanged: false,
  current: {
    id: 'system-default',
    version: '1.0.0',
    body: '默认开发说明',
    sha256: 'a'.repeat(64),
    publishedAt: null,
    binding: {
      release: {
        schemaVersion: 2,
        experimentId: 'convex-lens',
        url: `/physicsos/developers/downloads/physicsos-experiment-template-v2-${'b'.repeat(64)}.zip`,
        sha256: 'b'.repeat(64),
        bytes: 123,
      },
      contractMarkdown: '固定 V2，执行 npm run release',
    },
  },
  seed: {
    body: '默认开发说明',
    binding: {
      release: {
        schemaVersion: 2,
        experimentId: 'convex-lens',
        url: `/physicsos/developers/downloads/physicsos-experiment-template-v2-${'b'.repeat(64)}.zip`,
        sha256: 'b'.repeat(64),
        bytes: 123,
      },
      contractMarkdown: '固定 V2，执行 npm run release',
    },
  },
})
const button = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement
const bodyField = (): HTMLTextAreaElement =>
  screen.getByLabelText('Markdown 正文') as HTMLTextAreaElement
function fixture() {
  let state = initial()
  const api: DeveloperPromptApi = {
    get: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (input: PromptDraftInput) => {
      state = {
        ...state,
        revision: state.revision + 1,
        draft: {
          ...input,
          bindingFingerprint: 'c'.repeat(64),
          updatedAt: '2026-11-03T00:00:00Z',
          updatedBy: 'admin',
        },
      }
      return structuredClone(state)
    }),
    import: vi.fn(async (input: PromptImportInput) => {
      state = {
        ...state,
        revision: state.revision + 1,
        draft: {
          version: input.version,
          body: '# 导入说明',
          note: input.note,
          bindingFingerprint: 'c'.repeat(64),
          updatedAt: '2026-11-03T00:00:00Z',
          updatedBy: 'admin',
        },
      }
      return structuredClone(state)
    }),
    publish: vi.fn(async () => {
      if (!state.draft) throw new Error('missing draft')
      const item = {
        ...state.current,
        version: state.draft.version,
        body: state.draft.body,
        id: `prompt_${'1'.repeat(32)}`,
        publishedAt: '2026-11-03T00:00:00Z',
        note: state.draft.note,
        publishedBy: 'admin',
      }
      state = {
        ...state,
        current: item,
        draft: null,
        versions: [...state.versions, item],
        revision: state.revision + 1,
      }
      return structuredClone(state)
    }),
    activate: vi.fn(async (input: Parameters<DeveloperPromptApi['activate']>[0]) => {
      const item = state.versions.find(version => version.id === input.id)
      if (!item) throw new Error('unknown version')
      state = { ...state, current: item, revision: state.revision + 1 }
      return structuredClone(state)
    }),
  }
  return { api }
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('admin developer prompt editor', () => {
  it('keeps publishing disabled while editing, saves the draft, then explicitly publishes its version', async () => {
    const { api } = fixture()
    render(<AdminPromptTab api={api} />)
    await screen.findByDisplayValue('默认开发说明')
    expect(button('发布当前草稿').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('提示词版本'), { target: { value: '1.1.0' } })
    fireEvent.change(screen.getByLabelText('Markdown 正文'), {
      target: { value: '# 材质\n使用蓝色底板。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => { expect(button('发布当前草稿').disabled).toBe(false) })
    expect(screen.getByTestId('prompt-current').textContent).toContain('系统默认')
    fireEvent.click(screen.getByRole('button', { name: '发布当前草稿' }))
    await waitFor(() => { expect(screen.getByTestId('prompt-current').textContent).toContain('1.1.0') })
    expect(button('发布当前草稿').disabled).toBe(true)
    expect(screen.getByRole('button', { name: '从 1.1.0 继续编辑' })).not.toBeNull()
  })
  it('imports Markdown, permits subsequent editing, and rejects unsupported files without losing text', async () => {
    const { api } = fixture()
    render(<AdminPromptTab api={api} />)
    await screen.findByDisplayValue('默认开发说明')
    fireEvent.change(screen.getByLabelText('导入 Markdown'), {
      target: { files: [new File(['# 导入说明'], 'prompt.md', { type: 'text/markdown' })] },
    })
    await screen.findByDisplayValue('# 导入说明')
    fireEvent.change(screen.getByLabelText('Markdown 正文'), {
      target: { value: '# 导入后的修改' },
    })
    expect(button('发布当前草稿').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('导入 Markdown'), {
      target: { files: [new File(['html'], 'prompt.html')] },
    })
    await screen.findByRole('alert')
    expect(bodyField().value).toBe('# 导入后的修改')
  })
  it('retains unsaved text after a stale revision error and an explicit metadata refresh', async () => {
    const { api } = fixture()
    vi.mocked(api.save).mockRejectedValue(
      new DeveloperPromptApiError(409, 'REVISION_CONFLICT', '其他管理员已更新，请刷新。'),
    )
    render(<AdminPromptTab api={api} />)
    await screen.findByDisplayValue('默认开发说明')
    fireEvent.change(screen.getByLabelText('Markdown 正文'), {
      target: { value: '我未保存的文字' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '刷新服务器版本' }))
    await waitFor(() => { expect(button('保存草稿').disabled).toBe(false) })
    expect(bodyField().value).toBe('我未保存的文字')
  })
  it('does not replace edits made while an import is in flight and renders unsafe markup as text', async () => {
    const { api } = fixture()
    let resolveImport: ((value: PromptAdminView) => void) | undefined
    vi.mocked(api.import).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve
        }),
    )
    render(<AdminPromptTab api={api} />)
    await screen.findByDisplayValue('默认开发说明')
    fireEvent.change(screen.getByLabelText('导入 Markdown'), {
      target: { files: [new File(['body'], 'prompt.md')] },
    })
    await waitFor(() => { expect(resolveImport).toBeDefined() })
    fireEvent.change(screen.getByLabelText('Markdown 正文'), {
      target: { value: '<script>window.pwned=1</script>\n本地编辑' },
    })
    resolveImport?.({
      ...initial(),
      revision: 1,
      draft: {
        version: '1.0.0',
        body: '从文件导入的旧响应',
        note: '',
        bindingFingerprint: 'c'.repeat(64),
        updatedAt: '2026-11-03T00:00:00Z',
        updatedBy: 'admin',
      },
    })
    await waitFor(() => { expect(button('保存草稿').disabled).toBe(false) })
    expect(bodyField().value).toBe('<script>window.pwned=1</script>\n本地编辑')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByLabelText('完整提示词预览').textContent).toBe(
      renderPrompt(
        {
          version: '1.0.0',
          body: '<script>window.pwned=1</script>\n本地编辑',
          binding: initial().seed.binding,
        },
        location.origin,
      ),
    )
  })
})
