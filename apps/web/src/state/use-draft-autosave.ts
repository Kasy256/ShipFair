import { DRAFT_AUTOSAVE_MS } from '@shipfair/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type DraftFields, saveDraft } from '../lib/booth-api.ts';
import { loadSupabase } from '../lib/supabase.ts';

export type AutosaveStatus = 'idle' | 'waiting' | 'saving' | 'saved' | 'incomplete' | 'error';

interface Autosave {
  status: AutosaveStatus;
  boothId: string | null;
  slug: string | null;
  error: unknown;
  /** Saves now (cancelling the timer); resolves to the booth id. Used before submitting. */
  flush(): Promise<string>;
}

/**
 * Saves the /submit form as a `draft` row 5 s after the last change (prompt 08). `fields` is null
 * while the basics are incomplete, since the table's checks need them; nothing is saved then.
 * `isEnabled` is false for live booths, whose edits go to a revision on submit instead.
 */
export function useDraftAutosave(
  userId: string | null,
  initialId: string | null,
  fields: DraftFields | null,
  isEnabled: boolean,
): Autosave {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<unknown>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const idRef = useRef(initialId);
  const [boothId, setBoothId] = useState(initialId);
  const latest = useRef(fields);
  latest.current = fields;
  const savedJson = useRef<string | null>(null);
  // One save at a time; a flush waits for the one in flight.
  const inFlight = useRef<Promise<string> | null>(null);
  const key = fields ? JSON.stringify(fields) : null;

  const save = useCallback(async (): Promise<string> => {
    while (inFlight.current) await inFlight.current.catch(() => undefined);
    const current = latest.current;
    if (!current || !userId) throw new Error('draft_incomplete');
    const json = JSON.stringify(current);
    if (json === savedJson.current && idRef.current) return idRef.current;
    const run = (async () => {
      setStatus('saving');
      const client = await loadSupabase();
      if (!client) throw new Error('auth_not_configured');
      const saved = await saveDraft(client, userId, idRef.current, current);
      idRef.current = saved.id;
      savedJson.current = json;
      setBoothId(saved.id);
      setSlug(saved.slug);
      setStatus('saved');
      setError(null);
      return saved.id;
    })();
    inFlight.current = run;
    try {
      return await run;
    } catch (e) {
      setStatus('error');
      setError(e);
      throw e;
    } finally {
      inFlight.current = null;
    }
  }, [userId]);

  useEffect(() => {
    if (!isEnabled) return;
    if (key === null) {
      setStatus((s) => (s === 'idle' ? s : 'incomplete'));
      return;
    }
    if (key === savedJson.current) return;
    setStatus('waiting');
    const timer = setTimeout(() => {
      save().catch(() => undefined); // status and error are set by save()
    }, DRAFT_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [key, isEnabled, save]);

  return { status, boothId, slug, error, flush: save };
}
