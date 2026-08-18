/** Surface-neutral control-sequence sanitization for generic tool cards. */

const CONTROL_ESCAPE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu
const OSC_SEQUENCE = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/gu
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/gu
const ESC_SEQUENCE = /\u001b(?:[@-_]|[ -/]+[@-~]?)/gu

/** Remove control effects while keeping their presence visible to the user. */
export function sanitizePresentationText(value: unknown): string {
  return String(value ?? '')
    .replace(OSC_SEQUENCE, '⟦OSC⟧')
    .replace(CSI_SEQUENCE, '⟦ESC⟧')
    .replace(ESC_SEQUENCE, '⟦ESC⟧')
    .replace(/\r\n?/gu, '\\n')
    .replace(/\n/gu, '\\n')
    .replace(/\t/gu, '\\t')
    .replace(CONTROL_ESCAPE, character => `\\x${character.codePointAt(0)!.toString(16).padStart(2, '0')}`)
}
