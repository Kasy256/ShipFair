// Stands in for Supabase's REST API in Worker tests (miniflare `outboundService`): every outbound
// fetch from the web Worker lands here. `/__calls` counts REST reads, `/__mode` makes them fail.
const owner = '00000000-0000-4000-8000-000000000001';
const districts = [
  {
    id: 1,
    slug: 'ai-agents',
    name: 'AI Agents',
    theme: 'ai-agents',
    color: '#7c3aed',
    sort_order: 1,
  },
  {
    id: 2,
    slug: 'dev-tools',
    name: 'Dev Tools',
    theme: 'dev-tools',
    color: '#0ea5e9',
    sort_order: 2,
  },
];
const booth = (n, slug, name, tagline) => ({
  id: `6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a1${n}`,
  owner_id: owner,
  slug,
  name,
  tagline,
  description: null,
  url: `https://example.com/${slug}`,
  district_id: 1 + (n % 2),
  logo_key: null,
  media: [],
  pricing: 'free',
  tier: 'stall',
  approved_at: `2026-10-25T16:3${n}:00.000000+00:00`,
});
const booths = [
  booth(
    0,
    'example-pretend-pilot',
    'Pretend Pilot',
    'An imaginary agent that books imaginary flights',
  ),
  booth(
    1,
    'example-quote-maker',
    'Quote "Maker" <b>',
    'Escapes <script>alert("x")</script> & friends',
  ),
  // Invalid (http URL): dropped by the Worker, never sent to clients.
  {
    ...booth(2, 'example-bad-row', 'Bad Row', 'This row has a plain http link'),
    url: 'http://x.test',
  },
];
const profiles = [
  { id: owner, handle: 'maker1', display_name: 'Maker One', links: { github: 'maker1' } },
];

let calls = 0;
let mode = 'ok';

// biome-ignore lint/style/noDefaultExport: a Worker module's handler must be the default export.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__calls') return Response.json({ calls });
    if (url.pathname === '/__mode') {
      mode = await request.text();
      calls = 0;
      return new Response('ok');
    }
    calls++;
    if (mode === 'fail') return new Response('down', { status: 500 });
    if (request.headers.get('apikey') !== 'test-anon-key')
      return new Response('no key', { status: 401 });
    if (url.pathname === '/rest/v1/districts') return Response.json(districts);
    if (url.pathname === '/rest/v1/booths') {
      return Response.json(url.searchParams.get('status') === 'eq.approved' ? booths : []);
    }
    if (url.pathname === '/rest/v1/public_profiles') return Response.json(profiles);
    return new Response('unknown table', { status: 404 });
  },
};
