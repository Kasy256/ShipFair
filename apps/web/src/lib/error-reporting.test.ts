import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import { BOOT_SCRIPT_SHA256, contentSecurityPolicy } from '../../worker/security-headers.ts';

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
};
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');

describe('index.html inline boot-error script', () => {
  it('is the only inline script, and the CSP hash matches it exactly', async () => {
    expect(inlineScripts).toHaveLength(1);
    expect(`sha256-${await sha256(inlineScripts[0] ?? '')}`).toBe(BOOT_SCRIPT_SHA256);
  });

  it('a built CSP allows it by hash and allows no other inline script', () => {
    const csp = contentSecurityPolicy({ isDev: false });
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src ')) ?? '';
    expect(scriptSrc).toContain(`'${BOOT_SCRIPT_SHA256}'`);
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});
