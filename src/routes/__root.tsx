import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { useState } from 'react'
import type { ReactNode } from 'react'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: 'Sheet2JSON' },
      {
        name: 'description',
        content:
          'Extract public Google Sheets into structured JSON. Paste a link, get a table and downloadable JSON.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
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

function RootDocument({ children }: { children: ReactNode }) {
  // One client per render tree. Creating it in module scope would share a cache
  // between concurrent server renders.
  const [queryClient] = useState(createQueryClient)

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <QueryClientProvider client={queryClient}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
          >
            Skip to content
          </a>

          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <Link
                to="/"
                className="text-base font-bold tracking-tight text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 rounded"
              >
                Sheet2JSON
              </Link>
              <nav aria-label="Main">
                <Link
                  to="/history"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  activeProps={{
                    className: 'bg-slate-100 text-slate-900',
                  }}
                >
                  History
                </Link>
              </nav>
            </div>
          </header>

          <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
            {children}
          </main>

          <footer className="border-t border-slate-200 bg-white">
            <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500 sm:px-6">
              Public Google Sheets only. No OAuth, no private sheets, no
              accounts &mdash; extraction history is shared by every visitor of
              this instance.
            </div>
          </footer>
        </QueryClientProvider>

        <Scripts />
      </body>
    </html>
  )
}
