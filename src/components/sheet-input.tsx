import { useId, useState } from 'react'
import type { FormEvent } from 'react'

export interface SheetInputProps {
  onSubmit: (url: string) => void
  isPending: boolean
  error: string | null
  defaultValue?: string
  /** Whether someone is signed in. Gates the private-sheet affordances. */
  isSignedIn?: boolean
  /** Whether the signed-in account has a usable Google grant. */
  googleConnected?: boolean
}

/**
 * The single input of the app: paste a Google Sheets URL and submit.
 *
 * Client-side validation only covers "is something typed" - the authoritative
 * host/path check happens again on the server, because a client check is a UX
 * affordance, never a security control.
 *
 * The hint under the input is the honest answer to "can I paste my private
 * sheet?", which depends entirely on whether this visitor has a Google grant.
 */
export function SheetInput({
  onSubmit,
  isPending,
  error,
  defaultValue = '',
  isSignedIn = false,
  googleConnected = false,
}: SheetInputProps) {
  const [value, setValue] = useState(defaultValue)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()

  const shownError = localError ?? error

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = value.trim()
    if (url === '') {
      setLocalError('Please enter a Google Sheets URL.')
      return
    }
    setLocalError(null)
    onSubmit(url)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <label htmlFor={inputId} className="sr-only">
        Public Google Sheets URL
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <input
            id={inputId}
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              if (localError) setLocalError(null)
            }}
            disabled={isPending}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? errorId : undefined}
            className="w-full rounded-lg border border-line-strong bg-surface px-4 py-3 font-mono text-sm text-ink shadow-sm transition-colors placeholder:font-sans placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-subtle"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-surface shadow-sm transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-ink disabled:text-surface/50"
        >
          {isPending ? 'Extracting...' : 'Extract Data'}
        </button>
      </div>

      <p className="mt-3 text-xs text-ink-subtle">
        {isSignedIn && googleConnected
          ? 'Public sheets work for anyone. Your own private sheets work too â€” they are read with your Google permission and are only visible to you.'
          : isSignedIn
            ? 'Connect your Google account in Settings to read private sheets. Public sheets work either way.'
            : 'Public sheets work without an account. Sign in with Google to read your own private sheets.'}
      </p>

      {shownError ? (
        <p
          id={errorId}
          role="alert"
          className="mt-4 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-muted"
        >
          {shownError}
        </p>
      ) : null}
    </form>
  )
}
