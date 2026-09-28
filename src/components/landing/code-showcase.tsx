import { Link } from '@tanstack/react-router'

import { CodeBlock } from '#components/code-block'
import { SectionHeading } from '#components/landing/section'
import { ArrowRightIcon, CheckIcon } from '#components/landing/icons'

/**
 * The three snippets most readers arrive wanting.
 *
 * Shown as tabs rather than three stacked blocks: the audience for a landing page
 * already knows its language, and tabs keep the section to one screen of code.
 */
const SNIPPETS = [
  {
    id: 'curl',
    label: 'curl',
    code: `curl "https://sheet2json.app/api/v1/extract?url=$SHEET_URL" \\
  -H "Authorization: Bearer $S2J_KEY"`,
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    code: `const response = await fetch(
  \`https://sheet2json.app/api/v1/extract?url=\${encodeURIComponent(sheetUrl)}\`,
  { headers: { Authorization: \`Bearer \${process.env.S2J_KEY}\` } },
)

const sheet = await response.json()

console.log(sheet.title, sheet.rowCount)`,
  },
  {
    id: 'python',
    label: 'Python',
    code: `import os
import requests

sheet = requests.get(
    "https://sheet2json.app/api/v1/extract",
    params={"url": sheet_url},
    headers={"Authorization": f"Bearer {os.environ['S2J_KEY']}"},
    timeout=30,
).json()

for row in sheet["data"]:
    print(row)`,
  },
] as const

/** The API section: the claim on the left, a runnable request on the right. */
export function CodeShowcase() {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
      <div className="lg:col-span-5">
        <SectionHeading
          eyebrow="The API"
          title="One request, and the sheet is yours"
          description="Anonymous callers get a smaller per-IP budget, which is enough to try the whole thing before deciding anything. A key raises the limit and unlocks your own private sheets."
        />

        <ul className="mt-8 space-y-3">
          {[
            'Works with no account, no key and no signup',
            'Errors arrive as JSON with a stable code to branch on',
            'Successful extractions are cached, so polling is cheap',
          ].map((line) => (
            <li
              key={line}
              className="flex items-start gap-2.5 text-sm text-ink-muted"
            >
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-ink-faint" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <Link
          to="/docs"
          className="group mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-ink"
        >
          <span className="underline decoration-line-strong underline-offset-4 transition-colors group-hover:decoration-ink">
            Read the full reference
          </span>
          <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>

      <div className="lg:col-span-7">
        <CodeBlock tabs={SNIPPETS} />
      </div>
    </div>
  )
}
