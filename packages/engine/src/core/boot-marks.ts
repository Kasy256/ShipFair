/**
 * A one-off `performance.mark` per boot stage (`shipfair:physics`, `:city`, `:renderer`,
 * `:environment`, `:city-model`, `:city-built`,
 * `:shaders`, `:ready`), so DevTools' Timings track and the load test show where start-up goes.
 */
export function markBoot(stage: string): void {
  if (typeof performance !== 'undefined') performance.mark(`shipfair:${stage}`);
}
