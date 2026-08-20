import katex from 'katex'
import { useMemo } from 'react'
import { cn } from '../lib/cn.ts'

export function Formula({
  tex,
  display = false,
  className,
}: {
  tex: string
  display?: boolean
  className?: string
}) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        throwOnError: false,
        displayMode: display,
      }),
    [tex, display],
  )

  return (
    <span
      className={cn('text-[var(--text-primary)]', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
