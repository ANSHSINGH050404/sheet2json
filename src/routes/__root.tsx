import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import type { BeforeSendEvent } from '@vercel/analytics/react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import appCss from '../styles.css?url'
import { AnalyticsTracker } from '#components/analytics-tracker'
import { ThemeToggle } from '#components/theme-toggle'
import { sessionQueryKey, useSessionUser } from '#hooks/use-session'
import { sanitizeAnalyticsUrl } from '#lib/analytics'
import { unwrap } from '#lib/format'
import { THEME_SCRIPT } from '#lib/theme'
import { signOutFn } from '#server/api/auth'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'referrer', content: 'strict-origin' },
      { title: 'Sheet2JSON' },
      {
        name: 'description',
        content:
          'Extract Google Sheets into structured JSON. Paste a link, or pull any sheet into your code with a REST API and your own API key.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
    // Runs before the body is parsed, so the stored theme is already on <html>
    // when the first pixel is painted. See THEME_SCRIPT.
    scripts: [{ children: THEME_SCRIPT }],
  }),
  shellComponent: RootDocument,
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // History changes only when someone extracts, so a short stale time is
        // plenty; the mutation invalidates it explicitly.
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

function sanitizeVercelAnalyticsEvent(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  const url = sanitizeAnalyticsUrl(event.url)
  return url ? { ...event, url } : null
}

function RootDocument({ children }: { children: ReactNode }) {
  // One client per render tree. Creating it in module scope would share a cache
  // between concurrent server renders.
  const [queryClient] = useState(createQueryClient)
  const isEmbedView = useRouterState({
    select: (state) =>
      state.location.pathname === '/view' &&
      new URLSearchParams(state.location.searchStr).get('embed') === '1',
  })

  // The head theme script sets class/color-scheme from localStorage before React hydrates.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col bg-surface text-ink antialiased">
        <QueryClientProvider client={queryClient}>
          <AnalyticsTracker />

          {!isEmbedView ? (
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-surface"
            >
              Skip to content
            </a>
          ) : null}

          {!isEmbedView ? (
            <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
              <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
                <Link
                  to="/"
                  className="flex items-center gap-2 text-sm font-medium tracking-tight text-ink"
                >
                  <Mark />
                  Sheet2JSON
                </Link>
                <div className="flex items-center gap-2">
                  <SiteNav />
                  <ThemeToggle />
                </div>
              </div>
            </header>
          ) : null}

          {/*
            No width or padding here: the shell owns the chrome, and each page
            owns its own gutters. The landing page needs to reach both edges.
          */}
          <main id="main" className="flex-1">
            {children}
          </main>

          {!isEmbedView ? <SiteFooter /> : null}
        </QueryClientProvider>

        <Analytics beforeSend={sanitizeVercelAnalyticsEvent} />
        <Scripts />
      </body>
    </html>
  )
}

/**
 * The product mark: a tile ruled like a sheet.
 *
 * It inverts with the theme - a dark tile on the light page, a light tile on the
 * dark one - which is the same relationship the toggle itself has.
 */
function Mark() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 shrink-0">
      <rect width="20" height="20" rx="4.5" className="fill-ink" />
      <path
        d="M6 6.5h8M6 10h5M6 13.5h8"
        strokeWidth="1.25"
        strokeLinecap="round"
        className="stroke-surface"
      />
    </svg>
  )
}

const NAV_ITEM =
  'rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:ring-1 focus-visible:ring-ink focus-visible:outline-none'

/**
 * The header navigation.
 *
 * History and Settings only exist for a signed-in user, so they render only when
 * there is one. Hiding them beats offering a link that leads to a "sign in first"
 * page. Sign-in returns to wherever the visitor was, which is why the link is
 * built from the current path rather than hard-coded.
 */
function SiteNav() {
  const session = useSessionUser()
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  async function signOut() {
    await signOutFn().then(unwrap)
    // Both caches are now wrong: the session is gone, and the history belonged to
    // the account that just left. Clearing rather than invalidating matters here -
    // invalidating would refetch a list the new anonymous caller cannot read.
    queryClient.setQueryData(sessionQueryKey, null)
    queryClient.removeQueries({ queryKey: ['extractions'] })
    void router.invalidate()
  }

  const items = [
    { to: '/extract', label: 'Extract' },
    { to: '/docs', label: 'API' },
    { to: '/history', label: 'History', requiresAuth: true },
    { to: '/settings', label: 'Settings', requiresAuth: true },
  ].filter((item) => !item.requiresAuth || session.data)

  return (
    <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
      {items.map((item) => {
        // Exact match, read from the router rather than `activeProps`: two
        // Tailwind text-colour classes in one attribute resolve by stylesheet
        // order, which is not something to rely on for the current-page marker.
        const isActive = pathname === item.to

        return (
          <Link
            key={item.to}
            to={item.to}
            className={`${NAV_ITEM} ${
              isActive
                ? 'bg-surface-raised text-ink'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        )
      })}

      {session.data ? (
        <button
          type="button"
          onClick={signOut}
          className={`${NAV_ITEM} ml-1 text-ink-muted hover:text-ink`}
        >
          Sign out
        </button>
      ) : (
        <a
          href={`/auth/google?redirect=${encodeURIComponent(pathname)}`}
          className="ml-1 inline-flex h-8 items-center rounded-md bg-ink px-3 text-sm font-medium text-surface transition-colors hover:bg-ink-hover focus-visible:ring-1 focus-visible:ring-ink focus-visible:outline-none"
        >
          Sign in
        </a>
      )}
    </nav>
  )
}

/** Link columns. Everything here exists; nothing is a placeholder. */
const FOOTER_COLUMNS = [
  {
    heading: 'Product',
    links: [
      { to: '/extract', label: 'Extract a sheet' },
      { to: '/history', label: 'History' },
      { to: '/settings', label: 'Settings' },
    ],
  },
  {
    heading: 'Developers',
    links: [
      { to: '/docs', label: 'API reference' },
      { to: '/docs', hash: 'private', label: 'Private sheets' },
      { to: '/docs', hash: 'limits', label: 'Rate limits' },
      { to: '/docs', hash: 'errors', label: 'Errors' },
    ],
  },
] as const

function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <p className="flex items-center gap-2 text-sm font-medium tracking-tight text-ink">
              <Mark />
              Sheet2JSON
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Google Sheets as structured data, in the browser and over a REST
              API.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:gap-20">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <p className="text-xs font-medium tracking-[0.12em] text-ink-faint uppercase">
                  {column.heading}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.to}
                        hash={'hash' in link ? link.hash : undefined}
                        search={
                          link.to === '/extract'
                            ? { auth: undefined, signedOut: undefined }
                            : undefined
                        }
                        className="text-sm text-ink-muted transition-colors hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Sheet2JSON</p>
          <p>
            Public sheets work without an account. Private sheets are read with
            your own Google permission and stay private to you.
          </p>
        </div>
      </div>
    </footer>
  )
}
