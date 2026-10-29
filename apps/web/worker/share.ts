import { APP_NAME, type BoothPublic, Slug } from '@shipfair/shared';
import type { Context } from 'hono';
import type { Env } from './env.ts';
import { worldOrNull } from './world.ts';

/** Until prompt 16 renders real share cards, every booth uses this image. */
export const OG_PLACEHOLDER_PATH = '/og-placeholder.png';

type AppContext = Context<{ Bindings: Env }>;

interface ShareMeta {
  title: string;
  description: string;
  url: string;
  image: string;
}

/**
 * `setAttribute` only escapes `"`. That is enough inside a quoted attribute, but link scrapers
 * aren't all strict parsers, so `&`, `<` and `>` are escaped too.
 */
const attr = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Booth text is data: attributes go through `attr`, the title through `setInnerContent` (escaped). */
function injectMeta(page: Response, meta: ShareMeta): Response {
  const content = (value: string) => ({
    element(el: Element) {
      el.setAttribute('content', attr(value));
    },
  });
  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', content(meta.description))
    .on('meta[property="og:title"]', content(meta.title))
    .on('meta[property="og:description"]', content(meta.description))
    .on('meta[property="og:url"]', content(meta.url))
    .on('meta[property="og:image"]', content(meta.image))
    .on('meta[name="twitter:title"]', content(meta.title))
    .on('meta[name="twitter:description"]', content(meta.description))
    .on('meta[name="twitter:image"]', content(meta.image))
    .on('head', {
      element(el) {
        el.append(`<link rel="canonical" href="${attr(meta.url).replaceAll('"', '&quot;')}">`, {
          html: true,
        });
      },
    })
    .transform(page);
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A small standalone page: the SPA isn't needed to say "not here". */
export function notFoundPage(slug: string): string {
  const name = escapeHtml(APP_NAME);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Booth not found · ${name}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#f5f3ee;font:16px system-ui,sans-serif;text-align:center;padding:1rem}a{color:#ffb547;font-weight:600}a:focus-visible{outline:2px solid #f5f3ee;outline-offset:3px}</style>
</head>
<body>
<main>
<h1>That booth isn't in the city</h1>
<p>No approved booth is called “${escapeHtml(slug)}”. It may have been renamed or taken down.</p>
<p><a href="/">Walk around ${name}</a></p>
</main>
</body>
</html>`;
}

async function spaShell(c: AppContext): Promise<Response> {
  const index = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)));
  // A fresh Response so headers are mutable and the HTML always revalidates.
  const page = new Response(index.body, index);
  page.headers.set('cache-control', 'no-cache');
  return page;
}

function shareMeta(origin: string, booth: BoothPublic): ShareMeta {
  return {
    title: `${booth.name} · ${APP_NAME}`,
    description: booth.tagline,
    url: `${origin}/b/${booth.slug}`,
    image: `${origin}${OG_PLACEHOLDER_PATH}`,
  };
}

/** `GET /b/:slug`: the SPA with the booth's title, description and OG/Twitter tags. */
export async function sharePage(c: AppContext): Promise<Response> {
  const slug = c.req.param('slug') ?? '';
  if (!Slug.safeParse(slug).success) return c.html(notFoundPage(slug), 404);
  const origin = new URL(c.req.url).origin;
  const world = await worldOrNull(c.env, c.executionCtx, origin);
  // Supabase down: still open the city (the SPA shows its own retry), just without booth tags.
  if (!world) return spaShell(c);
  const booth = world.booths.find((b) => b.slug === slug);
  if (!booth) return c.html(notFoundPage(slug), 404);
  return injectMeta(await spaShell(c), shareMeta(origin, booth));
}
