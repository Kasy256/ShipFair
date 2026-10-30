import {
  BOOTH_MEDIA_MAX,
  BoothDraftInput,
  type BoothMedia,
  type BoothOwn,
  type ProfileLinks,
  ProfileLinks as ProfileLinksSchema,
} from '@shipfair/shared';
import * as z from 'zod';
import type { DraftFields } from '../../lib/booth-api.ts';

// The /submit form's model (prompt 08). Text fields live in React Hook Form, validated with this
// schema (built from BoothDraftInput, so the browser checks what the server re-checks). Images
// live beside it: they are uploaded as soon as they are picked, and the form keeps their keys.

/** Cloudflare's always-pass Turnstile site key, used in development when none is configured. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

const Draft = BoothDraftInput.shape;

/** Empty inputs come back as '' from the DOM; optional fields treat that as unset. */
const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const BoothForm = z.object({
  name: Draft.name,
  tagline: Draft.tagline,
  url: Draft.url,
  districtId: z.coerce.number().int().positive('Pick a district'),
  pricing: z.preprocess(blankToUndefined, Draft.pricing),
  description: z.preprocess(blankToUndefined, Draft.description),
  links: z.object({
    reddit: z.preprocess(blankToUndefined, ProfileLinksSchema.shape.reddit),
    x: z.preprocess(blankToUndefined, ProfileLinksSchema.shape.x),
    github: z.preprocess(blankToUndefined, ProfileLinksSchema.shape.github),
    site: z.preprocess(blankToUndefined, ProfileLinksSchema.shape.site),
  }),
});
export type BoothFormInput = z.input<typeof BoothForm>;
export type BoothFormValues = z.output<typeof BoothForm>;

/** An uploaded image. `blob` feeds the 3D preview; null for media loaded from an older draft. */
export interface MediaItem {
  readonly key: string;
  readonly w: number;
  readonly h: number;
  readonly blob: Blob | null;
  /** Object URL (or media host URL) for the thumbnail. */
  readonly src: string | null;
}

export interface FormMedia {
  readonly logo: MediaItem | null;
  readonly screenshots: readonly MediaItem[];
}

export const SCREENSHOTS_MAX = BOOTH_MEDIA_MAX;

export const STEPS = [
  { id: 'basics', title: 'Basics' },
  { id: 'media', title: 'Media' },
  { id: 'details', title: 'Details' },
  { id: 'preview', title: 'Preview' },
  { id: 'submit', title: 'Submit' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

/** Fields validated before leaving each step. */
export const STEP_FIELDS: Record<StepId, readonly (keyof BoothFormInput)[]> = {
  basics: ['name', 'tagline', 'url', 'districtId', 'pricing'],
  media: [],
  details: ['description', 'links'],
  preview: [],
  submit: [],
};

/** Live booths take edits to these only; the rest is locked (prompt 08 §7). */
export const REVISION_FIELDS: readonly (keyof BoothFormInput)[] = ['tagline', 'url', 'description'];

export function emptyForm(links: ProfileLinks): BoothFormInput {
  return {
    name: '',
    tagline: '',
    url: 'https://',
    districtId: 0,
    pricing: '',
    description: '',
    links: { reddit: '', x: '', github: '', site: '', ...links },
  } as BoothFormInput;
}

/** The form for an existing booth: a pending revision's fields win over the live booth's. */
export function formFromBooth(booth: BoothOwn, links: ProfileLinks): BoothFormInput {
  const source = booth.revision?.status === 'pending' ? booth.revision : booth;
  return {
    ...emptyForm(links),
    name: booth.name,
    tagline: source.tagline,
    url: source.url,
    districtId: booth.districtId,
    pricing: booth.pricing ?? '',
    description: source.description ?? '',
  } as BoothFormInput;
}

export function mediaFromBooth(booth: BoothOwn, src: (key: string) => string | null): FormMedia {
  const source = booth.revision?.status === 'pending' ? booth.revision : booth;
  const item = (key: string, w: number, h: number): MediaItem => ({
    key,
    w,
    h,
    blob: null,
    src: src(key),
  });
  return {
    logo: source.logoKey ? item(source.logoKey, 512, 512) : null,
    screenshots: source.media.map((m) => item(m.key, m.w, m.h)),
  };
}

export function mediaList(media: FormMedia): BoothMedia[] {
  return media.screenshots.map((m) => ({ type: 'image', key: m.key, w: m.w, h: m.h }));
}

/** The draft row, if the form is complete enough for the table's checks (else null). */
export function draftFields(values: unknown, media: FormMedia): DraftFields | null {
  const parsed = BoothForm.safeParse(values);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    name: v.name,
    tagline: v.tagline,
    url: v.url,
    districtId: v.districtId,
    pricing: v.pricing,
    description: v.description,
    logoKey: media.logo?.key,
    media: mediaList(media),
  };
}

/** Links as the profile stores them (empty ones dropped). */
export function cleanLinks(links: BoothFormValues['links']): ProfileLinks {
  return Object.fromEntries(Object.entries(links).filter(([, v]) => v)) as ProfileLinks;
}
