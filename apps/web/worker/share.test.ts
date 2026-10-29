import { exports } from 'cloudflare:workers';
import { APP_NAME } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';

const page = (path: string) => exports.default.fetch(`https://web.test${path}`);
const stubMode = (mode: 'ok' | 'fail') =>
  fetch('http://supabase.test/__mode', { method: 'POST', body: mode });

/** Reads `content` of a meta tag, decoding the entities HTMLRewriter writes. */
function meta(html: string, attr: 'name' | 'property', key: string): string | undefined {
  const tag = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html);
  return tag?.[1]
    ?.replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('GET /b/:slug', () => {
  beforeEach(async () => {
    await stubMode('ok');
    await exports.WebRpc.purgeWorld();
  });

  it('injects the booth title, description and OG/Twitter tags', async () => {
    const res = await page('/b/example-pretend-pilot');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const html = await res.text();
    const title = `Pretend Pilot · ${APP_NAME}`;
    const tagline = 'An imaginary agent that books imaginary flights';
    expect(html).toContain(`<title>${title}</title>`);
    expect(meta(html, 'name', 'description')).toBe(tagline);
    expect(meta(html, 'property', 'og:title')).toBe(title);
    expect(meta(html, 'property', 'og:description')).toBe(tagline);
    expect(meta(html, 'property', 'og:url')).toBe('https://web.test/b/example-pretend-pilot');
    expect(meta(html, 'property', 'og:image')).toBe('https://web.test/og-placeholder.png');
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'name', 'twitter:title')).toBe(title);
    expect(meta(html, 'name', 'twitter:description')).toBe(tagline);
    expect(meta(html, 'name', 'twitter:image')).toBe('https://web.test/og-placeholder.png');
    expect(html).toContain('<link rel="canonical" href="https://web.test/b/example-pretend-pilot"');
    // The SPA itself is still there.
    expect(html).toContain('<div id="root"></div>');
    expect(res.headers.get('content-security-policy')).toContain("object-src 'none'");
  });

  it('escapes booth text instead of injecting markup', async () => {
    const html = await (await page('/b/example-quote-maker')).text();
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>');
    expect(html).toContain('<title>Quote "Maker" &lt;b&gt; · ');
    expect(meta(html, 'property', 'og:description')).toBe(
      'Escapes <script>alert("x")</script> & friends',
    );
  });

  it('answers an unknown slug with a 404 page that links home', async () => {
    const res = await page('/b/no-such-booth');
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("That booth isn't in the city");
    expect(html).toContain('<a href="/">');
    expect(html).toContain('noindex');
  });

  it('answers a malformed slug with the 404 page, escaped', async () => {
    const res = await page('/b/%3Cimg%20src%3Dx%3E');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<img');
  });

  it('still serves the city (untagged) when Supabase is down', async () => {
    await stubMode('fail');
    const res = await page('/b/example-pretend-pilot');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`<title>${APP_NAME}</title>`);
  });
});
