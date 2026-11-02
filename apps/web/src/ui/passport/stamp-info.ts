import {
  type District,
  PASSPORT_BOOTH_MILESTONES,
  type StampCategory,
  type StampKey,
} from '@shipfair/shared';

// What each stamp looks like and says, in the book, the toast and the share image.

export interface StampInfo {
  title: string;
  /** How it is earned, shown under an empty slot too. */
  detail: string;
  /** One or two characters drawn in the stamp. */
  glyph: string;
  color: string;
}

export const BOOTH_STAMPS: readonly StampKey[] = PASSPORT_BOOTH_MILESTONES.map(
  (n): StampKey => `booths:${n}`,
);
export const SOCIAL_STAMPS: readonly StampKey[] = [
  'first:upvote',
  'first:note',
  'first:chat',
  'met-a-maker',
  'squad',
];

export const PAGE_TITLES: Record<StampCategory, string> = {
  districts: 'Districts',
  booths: 'Booths',
  social: 'People',
};

const SOCIAL: Record<string, StampInfo> = {
  'first:upvote': {
    title: 'First upvote',
    detail: 'Gave a booth a heart',
    glyph: '♥',
    color: '#ef4466',
  },
  'first:note': {
    title: 'Guestbook',
    detail: 'Signed a booth’s guestbook',
    glyph: '✎',
    color: '#f59e0b',
  },
  'first:chat': { title: 'Hello!', detail: 'Said something in chat', glyph: '✉', color: '#38bdf8' },
  'met-a-maker': {
    title: 'Met a maker',
    detail: 'Visited a booth while its maker was there',
    glyph: '★',
    color: '#a78bfa',
  },
  squad: {
    title: 'Squad',
    detail: 'Joined a friend with an invite link',
    glyph: '⚑',
    color: '#22c55e',
  },
};

const MILESTONE_TITLE: Record<number, string> = {
  1: 'First booth',
  10: 'Window shopper',
  50: 'Regular',
  100: 'Centurion',
};

/** Title, glyph and colour for any stamp; `districts` names the district ones. */
export function stampInfo(stamp: StampKey, districts: readonly District[]): StampInfo {
  if (stamp.startsWith('district:')) {
    const slug = stamp.slice('district:'.length);
    const district = districts.find((d) => d.slug === slug);
    const name = district?.name ?? slug;
    return {
      title: name,
      detail: `Spent 10 seconds in ${name}`,
      glyph: name.slice(0, 1).toUpperCase(),
      color: district?.color ?? '#7c5cff',
    };
  }
  if (stamp.startsWith('booths:')) {
    const n = Number(stamp.slice('booths:'.length));
    return {
      title: MILESTONE_TITLE[n] ?? `${n} booths`,
      detail: n === 1 ? 'Opened a booth' : `Opened ${n} booths`,
      glyph: String(n),
      color: '#00e5c7',
    };
  }
  return SOCIAL[stamp] ?? { title: stamp, detail: '', glyph: '•', color: '#7c5cff' };
}
