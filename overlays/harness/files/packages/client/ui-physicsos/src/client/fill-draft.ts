/**
 * Write an example into the Home composer. A live input machine receives a
 * native `input` event; the inert hero keeps the text as a guest draft via
 * `dsh-fill-composer`.
 * @param text - example prompt to place in the composer.
 * @param root - document or test container.
 */
export function fillComposerDraft(text: string, root: ParentNode = document): void {
  const el = root.querySelector('textarea')
  if (el instanceof HTMLTextAreaElement) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    if (descriptor?.set === undefined) {
      el.value = text
    } else {
      descriptor.set.call(el, text)
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
    el.focus()
  }
  window.dispatchEvent(new CustomEvent('dsh-fill-composer', { detail: text }))
}
