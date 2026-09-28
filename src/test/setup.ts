/**
 * Test setup, loaded via the `preload` key in `bunfig.toml`.
 *
 * `bun test` sets `NODE_ENV=test`, and Bun then loads `.env` / `.env.test`
 * instead of `.env.local` - so a plain `bun test` would not see DATABASE_URL and
 * the database integration tests would silently skip. This reads `.env.local`
 * (falling back to `.env`) into `process.env` for the test process only.
 *
 * Deliberately dependency-free: the app itself does not need a dotenv package.
 */
import { existsSync, readFileSync } from 'node:fs'

if (!process.env.DATABASE_URL) {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue

    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(
        line,
      )
      if (!match) continue

      const key = match[1]
      let value = match[2] ?? ''
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      if (quoted) value = value.slice(1, -1)

      if (key && value !== '' && process.env[key] === undefined) {
        process.env[key] = value
      }
    }
    break
  }
}
