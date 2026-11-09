/** Downloads are explicit user actions; generated URLs are revoked after the browser consumes them. */
export function downloadCanvasFile(content: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}
