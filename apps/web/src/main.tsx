import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { isWorldPath, startBoot, worldBooted } from './lib/boot.ts';
import { reportError, startErrorReporting } from './lib/error-reporting.ts';
import { router } from './router.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

// Sentry loads after the first interaction; boot errors wait in index.html's queue until then.
startErrorReporting();

const queryClient = new QueryClient();
startBoot(window.location.pathname, window.location.search, queryClient);
// Leaving the city before it is ready (to /submit, /me…) must not keep sign-in waiting.
router.subscribe(({ location }) => {
  if (!isWorldPath(location.pathname)) worldBooted();
});

// Render errors caught by an error boundary (React Router's included) never reach window.onerror.
createRoot(root, {
  onCaughtError: (error, info) => {
    console.error(error, info.componentStack);
    reportError(error);
  },
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
