import { createFileRoute } from '@tanstack/react-router'

import { startCookies } from '#server/auth/cookies'
import { completeAuth } from '#server/auth/oauth-callback'
import { consumeState } from '#server/auth/oauth-start'
import { createSession } from '#server/auth/session'

/**
 * `GET /auth/google/callback` - where Google sends the browser back.
 *
 * Three things happen, in this order, and the order is the security property:
 *
 *   1. Consume `state`. Until this succeeds we have no evidence Google is talking
 *      to a redirect this server started, and nothing else may happen.
 *   2. Exchange the code, which is what identifies the user and yields the grant.
 *   3. Start a session and redirect.
 *
 * Any failure redirects to the home page with an error flag rather than rendering
 * a raw Google error, and never leaks a code or token into a URL.
 */
export const Route = createFileRoute('/auth/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams
        const origin = new URL(request.url).origin

        // Google reports a user-declined consent screen as an error, and so does
        // a user who simply closed the tab. Neither should look like a crash.
        const oauthError = query.get('error')
        if (oauthError !== null) {
          console.warn(`[auth] google returned error=${oauthError}`)
          return redirect(`${origin}/?auth=declined`)
        }

        const code = query.get('code')
        if (code === null || code === '') {
          return redirect(`${origin}/?auth=missing_code`)
        }

        try {
          const { redirectTo } = await consumeState(query.get('state') ?? '')
          const { userId } = await completeAuth({ code, origin })
          await createSession(userId, startCookies)

          return redirect(`${origin}${redirectTo}`)
        } catch (error) {
          // Logged, not returned: the cause can contain the exchange response
          // body, which echoes the authorization code.
          console.error('[auth] sign-in failed', error)
          return redirect(`${origin}/?auth=failed`)
        }
      },
    },
  },
})

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}
