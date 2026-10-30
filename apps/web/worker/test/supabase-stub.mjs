// Stands in for every outbound fetch of the web Worker in tests (miniflare `outboundService`):
// Supabase (Auth, anon world reads, and a tiny in-memory PostgREST for the service role),
// Turnstile's siteverify, and fake booth sites under *.site.test. `/__calls` counts REST reads,
// `/__mode` makes them fail and resets the store, `/__seed` replaces service-role tables,
// `/__table/<name>` reads one back.
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

// Service-role tables (the in-memory PostgREST). Profiles carry created_at for the age check.
const defaultStore = () => ({
  profiles: [
    { id: owner, handle: 'maker1', created_at: '2026-01-01T00:00:00+00:00' },
    {
      id: '00000000-0000-4000-8000-000000000002',
      handle: 'newbie',
      created_at: new Date().toISOString(),
    },
  ],
  booths: [],
  booth_revisions: [],
  moderation_log: [],
});
let store = defaultStore();

const matches = (row, params) => {
  for (const [column, filter] of params) {
    if (column === 'select') continue;
    const value = String(row[column]);
    if (filter.startsWith('eq.') && value !== filter.slice(3)) return false;
    if (filter.startsWith('in.(') && !filter.slice(4, -1).split(',').includes(value)) return false;
  }
  return true;
};
const pick = (row, select) =>
  !select || select === '*'
    ? row
    : Object.fromEntries(select.split(',').map((column) => [column, row[column]]));

async function postgrest(request, table, url) {
  const rows = store[table];
  if (request.method === 'GET') {
    const select = url.searchParams.get('select');
    return Response.json(
      rows.filter((r) => matches(r, url.searchParams)).map((r) => pick(r, select)),
    );
  }
  if (request.method === 'POST') {
    // Column defaults the real tables have and the Worker relies on.
    const defaults = table === 'booth_revisions' ? { status: 'pending' } : {};
    const row = { id: crypto.randomUUID(), ...defaults, ...(await request.json()) };
    rows.push(row);
    return Response.json([row], { status: 201 });
  }
  if (request.method === 'PATCH') {
    const values = await request.json();
    const hit = rows.filter((r) => matches(r, url.searchParams));
    for (const row of hit) Object.assign(row, values);
    return Response.json(hit);
  }
  return new Response('method', { status: 405 });
}

// Fake booth sites: ok answers 200, down 500, hop redirects once to ok, loop forever, insecure
// to plain http.
function site(url) {
  const host = url.hostname.replace('.site.test', '');
  if (host === 'down') return new Response('down', { status: 500 });
  if (host === 'hop') return Response.redirect('https://ok.site.test/landing', 301);
  if (host === 'loop')
    return Response.redirect(`https://loop.site.test/${url.pathname.length}x`, 302);
  if (host === 'insecure') return Response.redirect('http://ok.site.test/', 301);
  return new Response('<h1>ok</h1>', { headers: { 'content-type': 'text/html' } });
}

async function siteverify(request) {
  const form = await request.formData();
  const secret = String(form.get('secret'));
  const success = secret.startsWith('1x') && String(form.get('response')).length > 0;
  return Response.json({ success, 'error-codes': success ? [] : ['invalid-input-response'] });
}

let calls = 0;
let mode = 'ok';
/** User ids `delete_account` was called for (`/__deleted`). */
let deleted = [];

// Access tokens the fake Auth accepts: the booth owner, and a user whose profile is gone.
const TOKENS = {
  'owner-token': owner,
  'newbie-token': '00000000-0000-4000-8000-000000000002',
  'ghost-token': '00000000-0000-4000-8000-0000000000aa',
};
const SERVICE_KEY = 'test-service-key';

// biome-ignore lint/style/noDefaultExport: a Worker module's handler must be the default export.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === 'challenges.cloudflare.com') return siteverify(request);
    if (url.hostname.endsWith('.site.test') || url.hostname === 'example.com') return site(url);
    if (url.pathname === '/__calls') return Response.json({ calls });
    if (url.pathname === '/__seed') {
      Object.assign(store, await request.json());
      return new Response('ok');
    }
    if (url.pathname.startsWith('/__table/')) return Response.json(store[url.pathname.slice(9)]);
    if (url.pathname === '/__deleted') return Response.json(deleted);
    if (url.pathname === '/__mode') {
      mode = await request.text();
      calls = 0;
      deleted = [];
      store = defaultStore();
      return new Response('ok');
    }
    calls++;
    if (mode === 'fail') return new Response('down', { status: 500 });
    const apikey = request.headers.get('apikey');
    if (url.pathname === '/auth/v1/user') {
      const token = request.headers.get('authorization')?.replace('Bearer ', '') ?? '';
      if (apikey !== 'test-anon-key' || !(token in TOKENS)) {
        return Response.json({ msg: 'invalid JWT' }, { status: 401 });
      }
      return Response.json({ id: TOKENS[token], aud: 'authenticated' });
    }
    if (apikey === SERVICE_KEY) {
      const table = url.pathname.replace('/rest/v1/', '');
      if (table in store) return postgrest(request, table, url);
      if (url.pathname === '/rest/v1/rpc/delete_account' && request.method === 'POST') {
        const { uid } = await request.json();
        deleted.push(uid);
        return Response.json(2);
      }
    }
    if (apikey !== 'test-anon-key') return new Response('no key', { status: 401 });
    if (url.pathname === '/rest/v1/districts') return Response.json(districts);
    if (url.pathname === '/rest/v1/booths') {
      return Response.json(url.searchParams.get('status') === 'eq.approved' ? booths : []);
    }
    if (url.pathname === '/rest/v1/public_profiles') return Response.json(profiles);
    return new Response('unknown table', { status: 404 });
  },
};
