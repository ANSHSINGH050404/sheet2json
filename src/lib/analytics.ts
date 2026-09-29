import type { PostHog } from 'posthog-js'

import type { SheetAgentOutput } from './sheet-agent'
import type { SheetAgentPlan } from './types'

const POSTHOG_DEFAULT_HOST = 'https://us.i.posthog.com'
const URL_PROPERTIES = [
  '$current_url',
  '$initial_current_url',
  '$pathname',
  '$referrer',
  '$initial_referrer',
  '$referring_domain',
  '$initial_referring_domain',
]

export type AnalyticsEvent =
  | { event: 'page_viewed'; route: AnalyticsRoute }
  | {
      event: 'sheet_extracted'
      row_count: number
      column_count: number
    }
  | { event: 'share_asset_copied'; kind: 'link' | 'embed' }
  | { event: 'sheet_assistant_requested' }
  | {
      event: 'sheet_assistant_completed'
      action: SheetAgentPlan['action']
      result_kind: SheetAgentOutput['kind']
    }
  | {
      event: 'sheet_data_downloaded'
      format: 'csv' | 'json'
      row_count: number
    }

export type AnalyticsRoute =
  | 'home'
  | 'extract'
  | 'docs'
  | 'history'
  | 'history_detail'
  | 'settings'
  | 'live_table'
  | 'other'

let postHogClientPromise: Promise<PostHog | null> | null = null

/** Maps paths to fixed route names so IDs and query strings never enter analytics. */
export function analyticsRouteForPath(pathname: string): AnalyticsRoute {
  if (pathname === '/') return 'home'
  if (pathname === '/extract') return 'extract'
  if (pathname === '/docs') return 'docs'
  if (pathname === '/history') return 'history'
  if (pathname.startsWith('/history/')) return 'history_detail'
  if (pathname === '/settings') return 'settings'
  if (pathname === '/view') return 'live_table'
  return 'other'
}

/** Removes sheet query strings and private extraction IDs before Vercel capture. */
export function sanitizeAnalyticsUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    url.search = ''
    url.hash = ''
    if (url.pathname.startsWith('/history/')) url.pathname = '/history/:id'
    return url.toString()
  } catch {
    return null
  }
}

/** Removes automatic location properties before PostHog sends an event. */
export function redactPostHogUrlProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const safeProperties = { ...properties }
  for (const property of URL_PROPERTIES) delete safeProperties[property]
  return safeProperties
}

/** Sends allow-listed product events only; prompts, rows, and sheet URLs are excluded. */
export function trackAnalytics(event: AnalyticsEvent): void {
  if (typeof window === 'undefined') return

  void getPostHogClient()
    .then((client) => {
      if (!client) return
      const { event: eventName, ...properties } = event
      client.capture(eventName, properties)
    })
    .catch(() => undefined)
}

function getPostHogClient(): Promise<PostHog | null> {
  if (import.meta.env.SSR) return Promise.resolve(null)
  if (typeof window === 'undefined') return Promise.resolve(null)

  const projectKey = import.meta.env.VITE_POSTHOG_KEY?.trim()
  if (!projectKey) return Promise.resolve(null)

  postHogClientPromise ??= import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(projectKey, {
        api_host:
          import.meta.env.VITE_POSTHOG_HOST?.trim() || POSTHOG_DEFAULT_HOST,
        defaults: '2026-08-30',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_performance: false,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_flags: true,
        person_profiles: 'never',
        persistence: 'memory',
        respect_dnt: true,
        property_denylist: URL_PROPERTIES,
        before_send: (event) => {
          if (!event?.properties) return event
          event.properties = redactPostHogUrlProperties(event.properties)
          return event
        },
      })
      return posthog
    })
    .catch(() => null)

  return postHogClientPromise
}
