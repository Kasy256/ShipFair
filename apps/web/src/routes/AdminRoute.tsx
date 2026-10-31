import { AdminMe, APP_NAME } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate } from 'react-router';
import { useSessionStore } from '../state/session-store.ts';
import { accessToken } from '../state/use-auth-sync.ts';

// The admin tools are their own chunk: it is only requested once the server has said this
// session is staff, so nobody else downloads a line of it (prompt 09).
const AdminApp = lazy(() => import('../admin/AdminApp.tsx').then((m) => ({ default: m.AdminApp })));

class NotStaffError extends Error {}

/** `GET /api/admin/me`: the server checks the token and the role. 401/403 mean "not staff". */
async function fetchAdminMe(): Promise<AdminMe> {
  const token = await accessToken();
  if (!token) throw new NotStaffError('signed out');
  const res = await fetch('/api/admin/me', { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) throw new NotStaffError(`status ${res.status}`);
  if (!res.ok) throw new Error(`admin check failed (${res.status})`);
  return AdminMe.parse(await res.json());
}

const loading = <p className="min-h-dvh bg-ink p-4 text-paper">Loading…</p>;

/** `/admin`: staff only. Everyone else is sent to the plaza. */
export function AdminRoute() {
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.userId);
  const me = useQuery({
    queryKey: ['admin-me', userId],
    queryFn: fetchAdminMe,
    enabled: status === 'signed-in',
    retry: (count, error) => !(error instanceof NotStaffError) && count < 2,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    document.title = `Admin · ${APP_NAME}`;
    return () => {
      document.title = APP_NAME;
    };
  }, []);

  if (status === 'loading' || (status === 'signed-in' && me.isPending)) return loading;
  if (status === 'guest' || me.error instanceof NotStaffError) return <Navigate to="/" replace />;
  if (me.isError || !me.data) {
    return (
      <main className="min-h-dvh bg-ink p-4 text-paper">
        <p role="alert">
          We couldn't check your staff access. Check your connection, then{' '}
          <button
            type="button"
            className="font-semibold text-accent"
            onClick={() => void me.refetch()}
          >
            try again
          </button>
          .
        </p>
      </main>
    );
  }
  return (
    <Suspense fallback={loading}>
      <AdminApp me={me.data} />
    </Suspense>
  );
}
