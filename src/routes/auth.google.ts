import { createFileRoute } from '@tanstack/react-router'

import { startAuth } from '#server/auth/oauth-start'
import { isGoogleAuthConfigured } from '#server/config'

/**
 * `GET /auth/google` - starts the sign-in flow.
 *
 * Stores a `state` value server-side and redirects to Google's consent screen.
 * The browser never sees the state itself; it only comes back on the callback.
 *
 * A plain GET navigation rather than a form post, so the flow works from a link
 * in the header and from a redirect in the app shell.
 */
export const Route = createFileRoute('/auth/google')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isGoogleAuthConfigured()) {
          return new Response(
            'Google sign-in is not configured on this deployment.',
            { status: 503, headers: { 'content-type': 'text/plain' } },
          )
        }

        const query = new URL(request.url).searchParams
        const { authorizeUrl } = await startAuth(new URL(request.url).origin, {
          // Sanitised inside startAuth: only a same-origin path survives.
          redirectTo: query.get('redirect') ?? '/',
        })

        return new Response(null, {
          status: 302,
          headers: { location: authorizeUrl },
        })
      },
    },
  },
})
