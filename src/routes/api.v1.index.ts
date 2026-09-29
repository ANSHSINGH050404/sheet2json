import { createFileRoute } from '@tanstack/react-router'

import { CORS_HEADERS, corsPreflight } from '#server/api/cors'
import { apiJson } from '#server/api/response'
import {
  isGoogleAuthConfigured,
  RATE_LIMIT_PER_IP,
  RATE_LIMIT_PER_KEY,
  RATE_LIMIT_PER_USER,
} from '#server/config'

/**
 * `GET /api/v1` - a machine-readable index of the API.
 *
 * Deliberately not a key-gated endpoint: an index that needs a credential is
 * useless to someone trying to work out whether they need one. It exposes only
 * endpoint paths and the published rate limits, both of which are public.
 */
export const Route = createFileRoute('/api/v1/')({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),

      GET: () =>
        apiJson(
          {
            name: 'Sheet2JSON API',
            version: 'v1',
            authentication: {
              type: 'bearer',
              header: 'Authorization: Bearer <api-key>',
              createKeysAt: '/settings',
              note: 'GET /api/v1/extract also serves unauthenticated callers under a smaller per-IP limit.',
            },
            endpoints: [
              {
                method: 'GET',
                path: '/api/v1/extract',
                description: 'Extract a Google Sheet as JSON, CSV or NDJSON.',
                query: {
                  url: 'required - the Google Sheets URL',
                  format: 'optional - json (default), csv, ndjson',
                },
                auth: 'optional',
              },
              {
                method: 'GET',
                path: '/api/v1/extractions',
                description: "List the caller's stored extractions.",
                query: { limit: 'optional - 1..200, default 50' },
                auth: 'required',
              },
              {
                method: 'GET',
                path: '/api/v1/endpoints/{id}',
                description:
                  'Fetch live rows from the sheet using the saved query recipe. Supports json, csv or ndjson.',
                query: { format: 'optional - json (default), csv, ndjson' },
                auth: 'required',
              },
              {
                method: 'GET',
                path: '/api/v1/extractions/{id}',
                description: 'Read one stored extraction, including its rows.',
                auth: 'required',
              },
              {
                method: 'DELETE',
                path: '/api/v1/extractions/{id}',
                description: "Delete one of the caller's stored extractions.",
                auth: 'required',
              },
              {
                method: 'GET',
                path: '/api/v1/me',
                description: 'Verify a key and read the remaining quota.',
                auth: 'required',
              },
            ],
            rateLimits: {
              perApiKey: `RATE_LIMIT_PER_KEY ?? ${RATE_LIMIT_PER_KEY}/hour`,
              perAccount: `RATE_LIMIT_PER_USER ?? ${RATE_LIMIT_PER_USER}/hour`,
              anonymous: `RATE_LIMIT_PER_IP ?? ${RATE_LIMIT_PER_IP}/hour per IP`,
              headers: [
                'RateLimit-Limit',
                'RateLimit-Remaining',
                'RateLimit-Reset',
              ],
            },
            privateSheets: {
              supported: true,
              requires: 'A signed-in account with Google connected.',
              note: 'A private sheet is only readable by an account that Google says has access to it.',
            },
            documentation: '/docs',
          },
          { headers: CORS_HEADERS },
        ),
    },
  },
})

export const googleAuthConfigured = isGoogleAuthConfigured
