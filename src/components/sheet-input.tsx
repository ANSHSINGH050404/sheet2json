import { useId, useState } from 'react'
import type { FormEvent } from 'react'

export interface SheetInputProps {
  onSubmit: (url: string) => void
  isPending: boolean
  error: string | null
  defaultValue?: string
}

/**
 * The single input of the app: paste a public Google Sheets URL and submit.
 *
 * Client-side validation only covers "is something typed" - the authoritative
 * host/path check happens again on the server, because client checks are a UX
 * affordance, never a security control.
 */
export function SheetInput({
  onSubmit,
  isPending,
  error,
  defaultValue = '',
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
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 shadow-sm transition-colors placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isPending ? 'Extracting...' : 'Extract Data'}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        The sheet must be shared as &ldquo;Anyone with the link &ndash; Viewer&rdquo;.
        Private sheets are not supported.
      </p>

      {shownError ? (
        <p
          id={errorId}
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {shownError}
        </p>
      ) : null}
    </form>
  )
}
