import { describe, expect, it } from 'bun:test'

import {
  OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  socialMeta,
} from '#lib/site'

/**
 * The link preview is the whole point of these constants, and it is invisible
 * until something is shared and the card comes out broken. These assertions are
 * cheap and catch the specific ways that happens: a relative image URL, a card
 * at the wrong aspect ratio for the platform that will crop it, or a description
 * long enough to be truncated mid-sentence.
 */

describe('social metadata', () => {
  it('gives every consumer the same image, absolutely addressed', () => {
    const meta = socialMeta('Title', 'Description')
    const images = meta
      .filter((tag) => tag.content === OG_IMAGE.url)
      .map((tag) => tag.name ?? tag.property)

    expect(images).toContain('og:image')
    expect(images).toContain('twitter:image')
    // A relative URL resolves against nothing here and renders as a broken card
    // everywhere, because the crawler fetches the image outside the page context.
    expect(OG_IMAGE.url.startsWith('https://')).toBe(true)
  })

  it('declares the image dimensions so a scraper can size the card', () => {
    const meta = socialMeta('Title', 'Description')
    const width = meta.find((tag) => tag.property === 'og:image:width')
    const height = meta.find((tag) => tag.property === 'og:image:height')

    expect(width?.content).toBe(String(OG_IMAGE.width))
    expect(height?.content).toBe(String(OG_IMAGE.height))
  })

  it('asks for the large card, since the small one crops to a letterbox', () => {
    const meta = socialMeta('Title', 'Description')
    const card = meta.find((tag) => tag.name === 'twitter:card')

    expect(card?.content).toBe('summary_large_image')
  })

  it('passes the given title through rather than the site name', () => {
    const meta = socialMeta('A specific page', 'A specific description')
    const ogTitle = meta.find((tag) => tag.property === 'og:title')
    const twitterTitle = meta.find((tag) => tag.name === 'twitter:title')

    expect(ogTitle?.content).toBe('A specific page')
    expect(twitterTitle?.content).toBe('A specific page')
  })

  it('has a description a search result will not truncate mid-sentence', () => {
    // Roughly the point at which Google and most social cards start clipping.
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(200)
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(50)
  })

  it('describes the card for anyone who cannot see it', () => {
    expect(OG_IMAGE.alt.length).toBeGreaterThan(20)
  })
})

describe('the image itself', () => {
  it('is the 1200x630 every social platform asks for', () => {
    // Anything else gets letterboxed by Twitter and cropped unpredictably by
    // Facebook, both of which cut the headline off.
    expect(OG_IMAGE.width / OG_IMAGE.height).toBeCloseTo(1200 / 630, 2)
  })

  it('is served from the canonical origin, not a deployment url', () => {
    expect(OG_IMAGE.url.startsWith(SITE_URL)).toBe(true)
  })
})

describe('site constants', () => {
  it('is https, so a shared card is not downgraded', () => {
    expect(SITE_URL.startsWith('https://')).toBe(true)
  })

  it('names the product rather than the repo', () => {
    expect(SITE_NAME).toBe('Sheet2JSON')
  })
})
