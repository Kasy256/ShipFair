# Licences

Every asset pack used in `art/` keeps its licence file here, one file per pack
(`pnpm art:inspect` copies them in and adds a line to `CREDITS.md`).

The rule:

- **CC0 only by default.** Quaternius and Kenney packs are CC0. Poly Pizza is fine with the CC0 filter on.
- **Never CC BY-NC** (or any non-commercial or no-derivatives licence).
- **Avoid CC BY** unless we are happy to credit the author on `/about`; if we use it, the credit goes in `CREDITS.md` the same day.
- **Mixamo** clips are free for games but the raw files may not be redistributed: commit only the retargeted, exported `art/export/animations/humanoid_clips.glb`, never the downloaded FBX.
- **Downloaded packs never get committed.** They live in `art/packs/` (gitignored) or `ART_PACKS_DIR`. Only our own exports in `art/export/` and working files in `art/source/` go into git (through LFS).

When you add a pack: copy its licence here as `<publisher>-<pack>.txt`, then add it to `CREDITS.md`.
