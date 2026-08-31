/**
 * Apply data-agent copy to one host composer card and return an exact cleanup.
 * alpha.2's Lexical surface renders a visible placeholder sibling in addition
 * to the editor attributes; older compatible surfaces still use a textarea.
 */
export function overrideComposerPlaceholder(
  card: ParentNode | null | undefined,
  placeholder: string,
): (() => void) | undefined {
  const textarea = card?.querySelector<HTMLTextAreaElement>('textarea') ?? null
  const lexical = card?.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]') ?? null
  const input = lexical ?? textarea
  if (input === null || (input instanceof HTMLTextAreaElement && input.disabled)) return

  const attribute = lexical === null ? 'placeholder' : 'data-placeholder'
  const hostPlaceholder = input.getAttribute(attribute)
  const visiblePlaceholder = lexical === null
    ? null
    : card?.querySelector<HTMLElement>('[data-composer-placeholder="true"]') ?? null
  const hostVisibleText = visiblePlaceholder?.textContent ?? null

  input.setAttribute(attribute, placeholder)
  if (visiblePlaceholder !== null) visiblePlaceholder.textContent = placeholder

  return () => {
    if (input.getAttribute(attribute) === placeholder) {
      if (hostPlaceholder === null) input.removeAttribute(attribute)
      else input.setAttribute(attribute, hostPlaceholder)
    }
    if (visiblePlaceholder?.textContent === placeholder) {
      visiblePlaceholder.textContent = hostVisibleText
    }
  }
}
