import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { analyticsRouteForPath, trackAnalytics } from '#lib/analytics'

/** Tracks route changes without recording URL query strings or dynamic IDs. */
export function AnalyticsTracker() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  useEffect(() => {
    trackAnalytics({
      event: 'page_viewed',
      route: analyticsRouteForPath(pathname),
    })
  }, [pathname])

  return null
}
