import { lazy, Suspense } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { InfoPage } from './routes/InfoPage.tsx';
import { WorldRoute } from './routes/WorldRoute.tsx';

// Vite replaces MODE at build time, so production bundles drop the asset page entirely.
const DevAssets =
  import.meta.env.MODE !== 'production'
    ? lazy(() => import('./dev/DevAssets.tsx').then((m) => ({ default: m.DevAssets })))
    : null;

const routes: RouteObject[] = [
  // One pathless parent, so the engine stays mounted while moving between these three.
  {
    element: <WorldRoute />,
    children: [{ index: true }, { path: 'b/:slug' }, { path: 'd/:district' }],
  },
  { path: 'submit', element: <InfoPage page="submit" /> },
  { path: 'me', element: <InfoPage page="me" /> },
  { path: 'admin', element: <InfoPage page="admin" /> },
  { path: 'rules', element: <InfoPage page="rules" /> },
  { path: 'privacy', element: <InfoPage page="privacy" /> },
  { path: 'terms', element: <InfoPage page="terms" /> },
];

if (DevAssets) {
  routes.push({
    path: 'dev/assets',
    element: (
      <Suspense fallback={<p className="p-4">Loading…</p>}>
        <DevAssets />
      </Suspense>
    ),
  });
}

export const router = createBrowserRouter(routes);
