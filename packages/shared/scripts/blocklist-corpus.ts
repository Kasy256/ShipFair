// Inputs the SQL filter is checked against: in Vitest against the JS matcher, and in the generated
// pgTAP test against the database. Every dataset word, its leet and suffixed forms, and words
// the dataset allows. Overlap cases like "xanaly" (see blocklist-sql.ts) are left out on purpose.

// biome-ignore format: a word list reads better packed
const DATASET_WORDS = [
  'abo', 'abeed', 'africoon', 'anal', 'anus', 'arabush', 'arse', 'ass', 'bastard', 'bestiality',
  'bitch', 'blowjob', 'bollocks', 'boob', 'boonga', 'buttplug', 'chingchong', 'chink', 'cock',
  'cuck', 'cum', 'cunt', 'deepthroat', 'dick', 'dildo', 'doggystyle', 'double penetration', 'dyke',
  'ejaculate', 'fag', 'felch', 'fellatio', 'finger bang', 'fisting', 'fuck', 'gangbang', 'handjob',
  'hentai', 'hooker', 'incest', 'jerk off', 'jizz', 'kike', 'lubejob', 'masturbate', 'negro',
  'nigger', 'orgasm', 'orgy', 'penis', 'piss', 'porn', 'prick', 'pussy', 'rape', 'retard', 'scat',
  'semen', 'sex', 'shit', 'slut', 'spastic', 'tit', 'tranny', 'turd', 'twat', 'vagina', 'wank',
  'whore',
];

// biome-ignore format: a word list reads better packed
const CLEAN = [
  'alice', 'ada_lovelace', 'Ada Lovelace', 'scunthorpe', 'assessment', 'class_act', 'bob_builder',
  'classic_dev', 'grape', 'therapist', 'analysis', 'cocktail', 'dickens', 'sussex', 'title',
  'constitution', 'maker_x1', 'cumbersome', 'document', 'scattered', 'pass', 'hello world',
  'arsenal', 'button', 'matisse', 'hancock', 'sextant', 'essex', 'raccoon', 'peacock', 'assassin',
  'grass', 'shipfair_fan', 'night_owl', 'pixel_pusher',
];

const leet = (w: string) => w.replace(/i/g, '1').replace(/o/g, '0').replace(/a/g, '@');

/** Names and phrases, profane and not. */
export const NAME_CORPUS: readonly string[] = [
  ...DATASET_WORDS,
  ...DATASET_WORDS.map((w) => `${w.toUpperCase()} dev`),
  ...DATASET_WORDS.map((w) => `${w.replaceAll(' ', '_')}_dev`),
  ...DATASET_WORDS.map(leet),
  ...CLEAN,
  'f***',
  'sh**',
  'b**ch',
  'fuuuuck',
  'shiiit',
  'fu_ck',
  'f u c k',
  'ｆｕｃｋ',
];
