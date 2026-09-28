import { Link } from '@tanstack/react-router'

import { ArrowRightIcon } from '#components/landing/icons'

/**
 * The closing band: the one inverted surface on the page.
 *
 * Unlike every other surface, this one does not flip. It is the dark moment at
 * the bottom of the page in both themes, and it is the reason `text-white` and
 * the raw neutrals below are literals rather than tokens. `text-white` on the
 * band is also what `currentColor` in `.grid-lines-light` resolves against, so
 * it has to be set here rather than left to the body.
 */
export function FinalCta() {
  return (
    <div className="px-6 py-16 sm:py-24">
      <div className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-lg border border-white/10 bg-black px-6 py-16 text-white sm:px-16 sm:py-20">
        <div
          aria-hidden="true"
          className="grid-lines grid-lines-light absolute inset-0 -z-10"
        />

        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.14em] text-neutral-500 uppercase">
            Get started
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-balance text-white sm:text-4xl">
            Read your first sheet as JSON.
          </h2>
          <p className="mt-4 text-base text-pretty text-neutral-400">
            Nothing to install and no account to create. If the sheet is public,
            you are one paste away.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/extract"
              search={{ auth: undefined, signedOut: undefined }}
              className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 focus-visible:outline-none sm:w-auto"
            >
              Start extracting
              <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/docs"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-neutral-800 px-5 text-sm font-medium text-white transition-colors hover:border-neutral-600 hover:bg-neutral-900 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 focus-visible:outline-none sm:w-auto"
            >
              Read the docs
            </Link>
          </div>
        </div>

        <p className="mt-12 border-t border-neutral-800 pt-5 font-mono text-xs text-neutral-500">
          curl https://sheet2json.app/api/v1/extract?url=&hellip;
        </p>
      </div>
    </div>
  )
}
