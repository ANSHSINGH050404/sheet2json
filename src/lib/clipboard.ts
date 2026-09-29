export const CLIPBOARD_COPY_ERROR =
  'Could not copy. Check your browser clipboard permissions.'

/** Writes text to the clipboard, returning false when browser access is denied. */
export async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
