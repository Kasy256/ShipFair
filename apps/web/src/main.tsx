import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { isWorldPath, startBoot, worldBooted } from './lib/boot.ts';
import { router } from './router.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

const queryClient = new QueryClient();
startBoot(window.location.pathname, window.location.search, queryClient);
// Leaving the city before it is ready (to /submit, /me…) must not keep sign-in waiting.
router.subscribe(({ location }) => {
  if (!isWorldPath(location.pathname)) worldBooted();
});

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
