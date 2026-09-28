import { createFileRoute } from '@tanstack/react-router'

import { BentoGrid } from '#components/landing/bento'
import { ClientStrip, Hero } from '#components/landing/hero'
import { CodeShowcase } from '#components/landing/code-showcase'
import { FinalCta } from '#components/landing/final-cta'
import { Section, SectionHeading } from '#components/landing/section'
import { Steps } from '#components/landing/steps'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      {
        title: 'Sheet2JSON - turn a Google Sheet into a JSON endpoint',
      },
      {
        name: 'description',
        content:
          'Paste a Google Sheets link and get structured JSON, or call one REST endpoint from a script, a webhook or a cron job. Public sheets need no account.',
      },
    ],
  }),
  component: LandingPage,
})

/**
 * The marketing page.
 *
 * The working extractor lives at `/extract`; this page exists to earn the click
 * that sends someone there, so every section either shows the response shape or
 * shows the request that produces it.
 */
function LandingPage() {
  return (
    <>
      <Hero />
      <ClientStrip />

      <Section divided={false}>
        <SectionHeading
          eyebrow="What you get"
          title="A spreadsheet, reduced to rows"
          description="Sheets are a fine way to hold data and a poor way to read it. This is the layer in between: the same rows, as something a program can use."
        />
        <BentoGrid />
      </Section>

      <Section>
        <CodeShowcase />
      </Section>

      <Section>
        <Steps />
      </Section>

      <FinalCta />
    </>
  )
}
