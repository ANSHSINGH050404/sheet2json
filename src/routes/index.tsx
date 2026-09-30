import { createFileRoute } from '@tanstack/react-router'

import { SITE_URL, socialMeta } from '#lib/site'
import { BentoGrid } from '#components/landing/bento'
import { ClientStrip, Hero } from '#components/landing/hero'
import { CodeShowcase } from '#components/landing/code-showcase'
import { FinalCta } from '#components/landing/final-cta'
import { Section, SectionHeading } from '#components/landing/section'
import { Steps } from '#components/landing/steps'

const TITLE = 'Sheet2JSON - turn a Google Sheet into a JSON endpoint'

const DESCRIPTION =
  'Paste a Google Sheets link and get structured JSON, or call one REST endpoint from a script, a webhook or a cron job. Public sheets need no account.'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      ...socialMeta(TITLE, DESCRIPTION),
    ],
    // The landing page is the only page that is a duplicate of anything else, so
    // this is the only place a canonical belongs.
    links: [{ rel: 'canonical', href: SITE_URL }],
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
