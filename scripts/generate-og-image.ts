/**
 * Rasterise the social preview card.
 *
 * The card is authored as SVG and rendered to `public/og.png` by sharp, which
 * keeps it regenerable without a design tool: change the constants below and
 * re-run `bun run og:image`. Committing the PNG rather than rendering it per
 * request means no runtime cost, no font embedding, and no dependency on the
 * host being able to rasterise anything.
 *
 * The colours and the sheet-to-JSON motif are the same ones the app already
 * uses, taken from the light theme tokens in `src/styles.css`:
 *   surface       oklch(100% 0 none)
 *   surface-muted oklch(98.5% 0 none)
 *   line          oklch(92.2% 0 none)
 *   line-strong   oklch(87% 0 none)
 *   ink           oklch(14.5% 0 none)
 *   ink-strong    oklch(26.9% 0 none)
 *   ink-muted     oklch(43.9% 0 none)
 *   ink-subtle    oklch(55.6% 0 none)
 *   ink-faint     oklch(70.8% 0 none)
 *
 * The preview rows are the same two columns and three rows the hero shows in
 * `src/components/landing/hero.tsx`, so the card and the landing page agree.
 */

import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import sharp from 'sharp'

/**
 * The card is laid out in a 1200x630 box, which is what every social platform
 * asks for, and rasterised at 4x then downsampled. Downsampling from 4x is what
 * gives the text clean edges: rendering straight to 1200px puts a hard
 * antialiasing decision on every glyph edge, and at card size that reads as
 * slightly soft type.
 */
const WIDTH = 1200
const HEIGHT = 630
const SCALE = 4

/** Light theme, as sRGB hex. See the token table above. */
const INK = '#191919'
const INK_MUTED = '#6a6a6a'
const INK_SUBTLE = '#8b8b8b'
const INK_FAINT = '#b4b4b4'
const SURFACE = '#ffffff'
const SURFACE_MUTED = '#fbfbfb'
const SURFACE_RAISED = '#f7f7f7'
const LINE = '#ececec'
const LINE_STRONG = '#dedede'

const SANS = "ui-sans-serif, system-ui, 'Segoe UI', Arial, sans-serif"
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** The app mark, matching `Mark()` in `src/routes/__root.tsx`. */
const MARK_PATH = 'M6 6.5h8M6 10h5M6 13.5h8'

const COLUMNS = ['name', 'email'] as const

const ROWS = [
  { name: 'Ansh', email: 'ansh@example.com' },
  { name: 'Rahul', email: 'rahul@example.com' },
  { name: 'Priya', email: 'priya@example.com' },
] as const

/**
 * The vertical budget, as baselines. Hand-placed rather than flowed, because
 * the card is a fixed canvas and every element has a known height: a flow
 * layout would let a font substitution push the panels off the bottom edge.
 * The total must leave `HEIGHT - 42` clear for the closing line.
 */
const MARK_TOP = 54
const MARK_SIZE = 34
const HEADLINE_SIZE = 58
const HEADLINE_STEP = 72
const HEADLINE_TOP = 168
const SUBHEAD_SIZE = 25
const SUBHEAD_STEP = 33
const SUBHEAD_TOP = 298
const PANEL_TOP = 368
const PANEL_LABEL_SIZE = 15
const CELL_SIZE = 17
const HEADER_HEIGHT = 40
const ROW_HEIGHT = 42
const FOOTER_BASELINE = 590

/**
 * The JSON panel needs room the table does not: a `[` on the header line and a
 * `]` below the last row, so it carries one extra row's worth of height. Giving
 * both panels the same height would either clip the bracket or leave the table
 * with a gap, so the extra height is carried by the bracket line alone.
 */
const BRACKET_HEIGHT = 30
const TABLE_PANEL_HEIGHT = HEADER_HEIGHT + ROWS.length * ROW_HEIGHT
const JSON_PANEL_HEIGHT = TABLE_PANEL_HEIGHT + BRACKET_HEIGHT
const PANEL_GAP = 24
const PANEL_PADDING = 72
const PANEL_WIDTH = (WIDTH - PANEL_PADDING * 2 - PANEL_GAP) / 2
const CELL_INSET = 20

/** XML-escape, because the row data is interpolated into text nodes. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function mark(x: number, y: number, size: number): string {
  return `
    <g transform="translate(${x} ${y}) scale(${size / 20})">
      <rect width="20" height="20" rx="4.5" fill="${INK}"/>
      <path d="${MARK_PATH}" stroke="${SURFACE}" stroke-width="1.25"
            stroke-linecap="round" fill="none"/>
    </g>`
}

function panelLabel(x: number, y: number, text: string): string {
  return `<text x="${x}" y="${y}" font-family="${SANS}" font-size="${PANEL_LABEL_SIZE}" font-weight="600" letter-spacing="2.2" fill="${INK_FAINT}">${esc(text)}</text>`
}

/**
 * The table half of the motif: a header row that becomes the keys.
 */
function table(x: number, y: number, width: number): string {
  const columnWidth = (width - CELL_INSET * 2) / COLUMNS.length

  const header = COLUMNS.map((column, index) => {
    const left = x + CELL_INSET + index * columnWidth
    return `<text x="${left}" y="${y + HEADER_HEIGHT - 14}" font-family="${MONO}" font-size="${CELL_SIZE}" fill="${INK_FAINT}">${esc(column)}</text>`
  }).join('\n')

  const body = ROWS.map((row, rowIndex) => {
    const top = y + HEADER_HEIGHT + rowIndex * ROW_HEIGHT
    const cells = ([row.name, row.email] as const).map((value, colIndex) => {
      const left = x + CELL_INSET + colIndex * columnWidth
      const fill = colIndex === 0 ? INK : INK_SUBTLE
      return `<text x="${left}" y="${top + 27}" font-family="${MONO}" font-size="${CELL_SIZE}" fill="${fill}">${esc(value)}</text>`
    })
    const rule =
      rowIndex === 0
        ? ''
        : `<line x1="${x}" y1="${top}" x2="${x + width}" y2="${top}" stroke="${LINE}" stroke-width="1"/>`
    return `${rule}\n${cells.join('\n')}`
  }).join('\n')

  return `
    <g>
      ${panelLabel(x, y - 14, 'TABLE')}
      <rect x="${x}" y="${y}" width="${width}" height="${TABLE_PANEL_HEIGHT}" rx="10" fill="${SURFACE_RAISED}"/>
      <line x1="${x}" y1="${y + HEADER_HEIGHT}" x2="${x + width}" y2="${y + HEADER_HEIGHT}" stroke="${LINE_STRONG}" stroke-width="1.5"/>
      ${header}
      ${body}
    </g>`
}

/**
 * The JSON half: the same rows, keyed. This is the product in one glance - the
 * header row becoming object keys, with nothing to map and nothing to maintain.
 */
function json(x: number, y: number, width: number): string {
  const left = x + CELL_INSET
  const baseline = y + HEADER_HEIGHT - 14

  const rows = ROWS.map((row, index) => {
    const top = y + HEADER_HEIGHT + index * ROW_HEIGHT
    const comma = index < ROWS.length - 1 ? ',' : ''
    return `<text x="${left}" y="${top + 27}" font-family="${MONO}" font-size="${CELL_SIZE}" xml:space="preserve"><tspan fill="${INK_FAINT}">{</tspan><tspan fill="${INK_SUBTLE}"> &quot;name&quot;</tspan><tspan fill="${INK_FAINT}">: </tspan><tspan fill="${INK}">&quot;${esc(row.name)}&quot;</tspan><tspan fill="${INK_SUBTLE}">, </tspan><tspan fill="${INK_SUBTLE}">&quot;email&quot;</tspan><tspan fill="${INK_FAINT}">: </tspan><tspan fill="${INK_SUBTLE}">&quot;${esc(row.email)}&quot;</tspan><tspan fill="${INK_FAINT}">}${comma}</tspan></text>`
  })

  return `
    <g>
      ${panelLabel(x, y - 14, 'JSON')}
      <rect x="${x}" y="${y}" width="${width}" height="${JSON_PANEL_HEIGHT}" rx="10" fill="${SURFACE_RAISED}"/>
      <text x="${left}" y="${baseline}" font-family="${MONO}" font-size="${CELL_SIZE}" fill="${INK_FAINT}">[</text>
      ${rows.join('\n')}
      <text x="${left}" y="${y + HEADER_HEIGHT + ROWS.length * ROW_HEIGHT + 22}" font-family="${MONO}" font-size="${CELL_SIZE}" fill="${INK_FAINT}">]</text>
    </g>`
}

function buildSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${SURFACE_MUTED}"/>
      <stop offset="45%" stop-color="${SURFACE}"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${SURFACE}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#wash)"/>

  ${mark(PANEL_PADDING, MARK_TOP, MARK_SIZE)}
  <text x="${PANEL_PADDING + MARK_SIZE + 14}" y="${MARK_TOP + MARK_SIZE * 0.7}" font-family="${SANS}" font-size="26" font-weight="600" letter-spacing="-0.4" fill="${INK}">Sheet2JSON</text>

  <text x="${PANEL_PADDING}" y="${HEADLINE_TOP}" font-family="${SANS}" font-size="${HEADLINE_SIZE}" font-weight="600" letter-spacing="-2" fill="${INK}">Turn a spreadsheet</text>
  <text x="${PANEL_PADDING}" y="${HEADLINE_TOP + HEADLINE_STEP}" font-family="${SANS}" font-size="${HEADLINE_SIZE}" font-weight="600" letter-spacing="-2" fill="${INK}">into an endpoint.</text>

  <text x="${PANEL_PADDING}" y="${SUBHEAD_TOP}" font-family="${SANS}" font-size="${SUBHEAD_SIZE}" fill="${INK_MUTED}">Paste a Google Sheets link, get structured JSON.</text>
  <text x="${PANEL_PADDING}" y="${SUBHEAD_TOP + SUBHEAD_STEP}" font-family="${SANS}" font-size="${SUBHEAD_SIZE}" fill="${INK_MUTED}">Public sheets need no account.</text>

  ${table(PANEL_PADDING, PANEL_TOP, PANEL_WIDTH)}
  ${json(PANEL_PADDING + PANEL_WIDTH + PANEL_GAP, PANEL_TOP, PANEL_WIDTH)}

  <text x="${PANEL_PADDING}" y="${FOOTER_BASELINE}" font-family="${SANS}" font-size="23" fill="${INK_SUBTLE}">The header row becomes the keys.</text>
</svg>`
}

const output = resolve(import.meta.dir, '..', 'public', 'og.png')

await mkdir(dirname(output), { recursive: true })
await sharp(Buffer.from(buildSvg()), { density: 72 * SCALE })
  .resize(WIDTH, HEIGHT)
  .png({ compressionLevel: 9 })
  .toFile(output)

console.log(`wrote ${output} (${WIDTH}x${HEIGHT})`)
