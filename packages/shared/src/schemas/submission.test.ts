import { describe, expect, it } from 'vitest';
import {
  BoothRevisionInput,
  keySha256,
  SubmitBoothRequest,
  UploadSignRequest,
  uploadKey,
} from './submission.ts';

const user = '00000000-0000-4000-8000-000000000002';
const sha = 'a'.repeat(64);

describe('upload keys', () => {
  it('name objects by owner and content hash', () => {
    expect(uploadKey(user, sha)).toBe(`u/${user}/${sha}.webp`);
    expect(keySha256(uploadKey(user, sha))).toBe(sha);
  });

  it('reject keys that are not content addressed', () => {
    expect(keySha256(`u/${user}/logo.webp`)).toBeNull();
    expect(keySha256(`pending/u/${user}/${sha}.webp`)).toBeNull();
    expect(keySha256(`u/${user}/${sha}.png`)).toBeNull();
  });
});

describe('UploadSignRequest', () => {
  it('accepts WebP only, with a positive size and a hex sha256', () => {
    const ok = { kind: 'logo', contentType: 'image/webp', bytes: 1000, sha256: sha };
    expect(UploadSignRequest.safeParse(ok).success).toBe(true);
    expect(UploadSignRequest.safeParse({ ...ok, contentType: 'image/png' }).success).toBe(false);
    expect(UploadSignRequest.safeParse({ ...ok, bytes: 0 }).success).toBe(false);
    expect(UploadSignRequest.safeParse({ ...ok, sha256: 'A'.repeat(64) }).success).toBe(false);
    expect(UploadSignRequest.safeParse({ ...ok, kind: 'video' }).success).toBe(false);
  });
});

describe('submission bodies', () => {
  it('need a Turnstile token', () => {
    expect(SubmitBoothRequest.safeParse({ turnstileToken: '' }).success).toBe(false);
    expect(SubmitBoothRequest.safeParse({ turnstileToken: 'XXXX.DUMMY.TOKEN' }).success).toBe(true);
  });

  it('revisions require a logo and an https link, and default media to []', () => {
    const revision = {
      tagline: 'A better tagline for the booth',
      url: 'https://example.com',
      logoKey: uploadKey(user, sha),
    };
    expect(BoothRevisionInput.parse(revision).media).toEqual([]);
    expect(BoothRevisionInput.safeParse({ ...revision, logoKey: undefined }).success).toBe(false);
    expect(BoothRevisionInput.safeParse({ ...revision, url: 'http://x.com' }).success).toBe(false);
  });
});
