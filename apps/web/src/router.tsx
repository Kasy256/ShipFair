import { lazy, type ReactNode, Suspense } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { AUTH_CALLBACK_PATH } from './lib/supabase.ts';
import { RootLayout } from './routes/RootLayout.tsx';
import { WorldRoute } from './routes/WorldRoute.tsx';

// Every page but the city is its own chunk (prompt 14), so a first visit to the city downloads
// only the shell, the engine, three and Rapier.
const loading = <p className="min-h-dvh bg-ink p-4 text-paper">Loading…</p>;
const suspend = (element: ReactNode) => <Suspense fallback={loading}>{element}</Suspense>;

// The form (React Hook Form, image pipeline, booth preview) loads only when someone opens it.
const SubmitPage = lazy(() =>
  import('./routes/SubmitPage.tsx').then((m) => ({ default: m.SubmitPage })),
);
const MePage = lazy(() => import('./routes/MePage.tsx').then((m) => ({ default: m.MePage })));
const ProfilePage = lazy(() =>
  import('./routes/ProfilePage.tsx').then((m) => ({ default: m.ProfilePage })),
);
const AuthCallback = lazy(() =>
  import('./routes/AuthCallback.tsx').then((m) => ({ default: m.AuthCallback })),
);
const InfoPage = lazy(() => import('./routes/InfoPage.tsx').then((m) => ({ default: m.InfoPage })));
// Staff only: the guard asks the server, then lazy-loads the admin tools (another chunk).
const AdminRoute = lazy(() =>
  import('./routes/AdminRoute.tsx').then((m) => ({ default: m.AdminRoute })),
);
// Vite replaces MODE at build time, so production bundles drop the asset page entirely.
const DevAssets =
  import.meta.env.MODE !== 'production'
    ? lazy(() => import('./dev/DevAssets.tsx').then((m) => ({ default: m.DevAssets })))
    : null;

const pages: RouteObject[] = [
  // One pathless parent, so the engine stays mounted while moving between these three.
  {
    element: <WorldRoute />,
    children: [{ index: true }, { path: 'b/:slug' }, { path: 'd/:district' }],
  },
  { path: 'submit', element: suspend(<SubmitPage />) },
  { path: 'me', element: suspend(<MePage />) },
  { path: 'u/:handle', element: suspend(<ProfilePage />) },
  { path: AUTH_CALLBACK_PATH.slice(1), element: suspend(<AuthCallback />) },
  { path: 'admin', element: suspend(<AdminRoute />) },
  { path: 'rules', element: suspend(<InfoPage page="rules" />) },
  { path: 'privacy', element: suspend(<InfoPage page="privacy" />) },
  { path: 'terms', element: suspend(<InfoPage page="terms" />) },
];

if (DevAssets) pages.push({ path: 'dev/assets', element: suspend(<DevAssets />) });

// One root for every page: it keeps the session in step and hosts sign-in and onboarding.
export const router = createBrowserRouter([{ element: <RootLayout />, children: pages }]);
