/**
 * Apply data-agent copy to one host composer card and return an exact cleanup.
 * alpha.2's Lexical surface renders a visible placeholder sibling in addition
 * to the editor attributes; older compatible surfaces still use a textarea.
 */
export declare function overrideComposerPlaceholder(card: ParentNode | null | undefined, placeholder: string): (() => void) | undefined;
