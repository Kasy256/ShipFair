import { APP_NAME, APP_TAGLINE } from '@shipfair/shared';

export function App() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink font-sans text-paper">
      {/* The engine mounts here from prompt 04 on. */}
      <canvas className="absolute inset-0 h-full w-full" />
      <div className="relative flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="font-bold text-5xl text-accent tracking-tight">{APP_NAME}</h1>
        <p className="max-w-md text-lg opacity-80">{APP_TAGLINE}</p>
      </div>
    </main>
  );
}
