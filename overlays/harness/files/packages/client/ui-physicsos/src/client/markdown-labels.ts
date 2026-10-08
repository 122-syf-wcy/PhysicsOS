/**
 * Localized chrome for the shared Cordis-free Markdown primitive.
 *
 * `MarkdownText` renders code fences and footnotes through owner-supplied copy
 * (the primitives package owns no locale namespace), so every PhysicsOS call
 * site builds its labels from the product dictionary here instead of borrowing
 * the Chat target's.
 */

import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PhysicsosKey } from './locales.ts'

/**
 * Build the complete Markdown chrome labels for one locale revision.
 * @param t - a PhysicsOS dictionary lookup (the slot locale seat or the
 *   admin tabs' plain translate callback).
 * @returns code-fence and footnote copy.
 */
export function markdownLabels(t: (key: PhysicsosKey) => string): MarkdownLabels {
  return {
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
      toolbarLabels: {
        codeLabel: t('markdown.code'),
        wrapLabel: t('markdown.wrap'),
        unwrapLabel: t('markdown.unwrap'),
      },
    },
    footnotes: t('markdown.footnotes'),
  }
}
