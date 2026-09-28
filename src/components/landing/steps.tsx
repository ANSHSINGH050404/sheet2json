import { SectionHeading } from '#components/landing/section'

/** The whole flow, in three steps, with no feature list wrapped around it. */
const STEPS = [
  {
    title: 'Paste a Sheets link',
    body: 'Any tab, any gid. The URL is checked against a strict allow-list before a request is allowed to leave the app, so a link can only ever point at a spreadsheet.',
  },
  {
    title: 'Add a key, or skip it',
    body: 'Public sheets need no account at all. A key raises the rate limit, records history against your account and is what makes your own private sheets readable.',
  },
  {
    title: 'Take the rows',
    body: 'Download the JSON, copy it into a response body, or page through the table. The shape is identical in the browser and over the API.',
  },
] as const

/** Three steps divided by hairlines rather than numbered badges. */
export function Steps() {
  return (
    <div>
      <SectionHeading
        eyebrow="How it works"
        title="From a link to data in three steps"
        description="There is no setup wizard, because there is nothing to set up before the first request."
      />

      <ol className="mt-12 grid gap-8 sm:grid-cols-3 sm:divide-x sm:divide-line sm:gap-0">
        {STEPS.map((step, index) => (
          <li key={step.title} className="sm:px-8 sm:first:pl-0 sm:last:pr-0">
            <p className="font-mono text-xs text-ink-faint">
              {String(index + 1).padStart(2, '0')}
            </p>
            <h3 className="mt-3 text-sm font-medium text-ink">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-pretty text-ink-muted">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
