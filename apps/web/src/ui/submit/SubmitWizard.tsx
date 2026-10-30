import { zodResolver } from '@hookform/resolvers/zod';
import type { BoothPreviewContent } from '@shipfair/engine';
import { type BoothOwn, type District, isHttpsUrl, type OwnProfile } from '@shipfair/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { track } from '../../lib/analytics.ts';
import { checkBoothUrl, submitBooth, submitRevision } from '../../lib/booth-api.ts';
import { loadSupabase } from '../../lib/supabase.ts';
import { useSessionStore } from '../../state/session-store.ts';
import { accessToken } from '../../state/use-auth-sync.ts';
import { useDraftAutosave } from '../../state/use-draft-autosave.ts';
import { boothErrorText } from '../errors.ts';
import { BoothPreviewCanvas } from './BoothPreviewCanvas.tsx';
import {
  BoothForm,
  type BoothFormInput,
  type BoothFormValues,
  cleanLinks,
  draftFields,
  type FormMedia,
  mediaList,
  STEP_FIELDS,
  STEPS,
  type StepId,
} from './booth-form.ts';
import { StepBasics } from './StepBasics.tsx';
import { StepDetails } from './StepDetails.tsx';
import { StepMedia } from './StepMedia.tsx';
import { StepNav } from './StepNav.tsx';
import { StepSubmit } from './StepSubmit.tsx';
import { SubmitDone } from './SubmitDone.tsx';

const URL_WARNING =
  "We couldn't reach this URL. Check it opens in a browser; you can still submit.";

const AUTOSAVE_TEXT = {
  idle: '',
  waiting: 'Unsaved changes…',
  saving: 'Saving draft…',
  saved: 'Draft saved',
  incomplete: 'Fill in the basics to save a draft',
  error: "Couldn't save the draft; we'll retry when you edit",
} as const;

interface SubmitWizardProps {
  profile: OwnProfile;
  districts: readonly District[];
  /** The booth being edited (draft, rejected or live), or null for a new one. */
  booth: BoothOwn | null;
  defaults: BoothFormInput;
  initialMedia: FormMedia;
}

/** The /submit form (prompt 08): five steps, autosaved as a draft, submitted with Turnstile. */
export function SubmitWizard({
  profile,
  districts,
  booth,
  defaults,
  initialMedia,
}: SubmitWizardProps) {
  const isRevision = booth?.status === 'approved';
  const navigate = useNavigate();
  const setProfile = useSessionStore((s) => s.setProfile);
  const methods = useForm<BoothFormInput, unknown, BoothFormValues>({
    resolver: zodResolver(BoothForm),
    defaultValues: defaults,
    mode: 'onTouched',
  });
  const values = useWatch({ control: methods.control });
  const [media, setMedia] = useState(initialMedia);
  const [step, setStep] = useState<StepId>('basics');
  const [reached, setReached] = useState(booth ? STEPS.length - 1 : 0);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [urlWarning, setUrlWarning] = useState<string | null>(null);
  const checkedUrl = useRef<string | null>(null);
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [isRulesAccepted, setIsRulesAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  const fields = isRevision ? null : draftFields(values, media);
  const autosave = useDraftAutosave(profile.id, booth?.id ?? null, fields, !isRevision);

  useEffect(() => track({ name: 'submit_started', props: { isEdit: booth !== null } }), [booth]);

  // Keep the draft's id in the address, so a reload resumes the same draft.
  useEffect(() => {
    if (autosave.boothId && !booth) {
      navigate(`/submit?booth=${autosave.boothId}`, { replace: true });
    }
  }, [autosave.boothId, booth, navigate]);

  const checkUrl = async () => {
    const url = methods.getValues('url');
    if (typeof url !== 'string' || !isHttpsUrl(url) || url === checkedUrl.current) return;
    checkedUrl.current = url;
    try {
      const token = await accessToken();
      if (!token) return;
      const result = await checkBoothUrl(token, url);
      setUrlWarning(result.isReachable ? null : URL_WARNING);
    } catch {
      setUrlWarning(null); // the check is only a hint; the pre-screen checks again
    }
  };

  const go = async (target: StepId) => {
    const from = STEPS.findIndex((s) => s.id === step);
    const to = STEPS.findIndex((s) => s.id === target);
    if (to > from) {
      if (!(await methods.trigger([...STEP_FIELDS[step]]))) return;
      if (step === 'media' && !media.logo) {
        setLogoError('Add a logo to continue');
        return;
      }
    }
    setLogoError(null);
    setStep(target);
    setReached((r) => Math.max(r, to));
  };

  const submit = methods.handleSubmit(async (form) => {
    if (!media.logo) {
      setStep('media');
      setLogoError('Add a logo before submitting');
      return;
    }
    if (!turnstile) return;
    setIsSubmitting(true);
    setFailure(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error('signed_out');
      if (isRevision && booth) {
        const revision = {
          tagline: form.tagline,
          url: form.url,
          logoKey: media.logo.key,
          media: mediaList(media),
          ...(form.description ? { description: form.description } : {}),
        };
        const result = await submitRevision(token, booth.id, revision, turnstile);
        track({
          name: 'submit_completed',
          props: { boothId: booth.id, kind: 'revision', score: result.prescreen.score },
        });
      } else {
        const links = cleanLinks(form.links);
        if (JSON.stringify(links) !== JSON.stringify(profile.links)) {
          const client = await loadSupabase();
          const { error } =
            (await client?.from('profiles').update({ links }).eq('id', profile.id)) ?? {};
          if (!error) setProfile({ ...profile, links });
        }
        const id = await autosave.flush();
        const result = await submitBooth(token, id, turnstile);
        track({
          name: 'submit_completed',
          props: { boothId: id, kind: 'booth', score: result.prescreen.score },
        });
      }
      setIsDone(true);
    } catch (error) {
      setFailure(boothErrorText(error));
      setTurnstile(null);
      setTurnstileKey((k) => k + 1);
    } finally {
      setIsSubmitting(false);
    }
  });

  const district = districts.find((d) => d.id === Number(values.districtId)) ?? districts[0];
  const preview = useMemo<BoothPreviewContent>(
    () => ({
      name: values.name || 'Your booth',
      theme: district?.theme ?? 'default',
      districtColor: district?.color ?? '#ffffff',
      accentSeed: booth?.id ?? profile.id,
      logo: media.logo?.blob ?? null,
      screenshots: media.screenshots.flatMap((s) => (s.blob ? [s.blob] : [])),
    }),
    [values.name, district, booth, profile.id, media],
  );

  if (isDone) return <SubmitDone isRevision={isRevision} hasUrlWarning={urlWarning !== null} />;

  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <FormProvider {...methods}>
      <form onSubmit={(e) => void submit(e)} noValidate className="mt-6" data-step={step}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StepNav current={step} reached={reached} onGo={(s) => void go(s)} />
          <p className="text-muted text-sm" aria-live="polite" data-testid="autosave">
            {isRevision
              ? 'Edits to a live booth are saved when you submit.'
              : AUTOSAVE_TEXT[autosave.status]}
          </p>
        </div>
        <section className="mt-4 rounded-2xl bg-ink-2 p-5" aria-labelledby="step-title">
          <h2 id="step-title" className="mb-4 font-bold text-xl">
            {STEPS[index]?.title}
          </h2>
          {step === 'basics' && (
            <StepBasics
              districts={districts}
              isRevision={isRevision}
              urlWarning={urlWarning}
              onUrlBlur={() => void checkUrl()}
            />
          )}
          {step === 'media' && (
            <StepMedia media={media} onChange={setMedia} logoError={logoError} />
          )}
          {step === 'details' && <StepDetails isRevision={isRevision} />}
          {step === 'preview' && <BoothPreviewCanvas content={preview} />}
          {step === 'submit' && (
            <StepSubmit
              isRevision={isRevision}
              isRulesAccepted={isRulesAccepted}
              onRulesChange={setIsRulesAccepted}
              turnstileKey={turnstileKey}
              onToken={setTurnstile}
              canSubmit={isRulesAccepted && turnstile !== null}
              isSubmitting={isSubmitting}
              failure={failure}
            />
          )}
        </section>
        <div className="mt-4 flex gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={() => void go(STEPS[index - 1]?.id ?? 'basics')}
              className="rounded-xl bg-ink-3 px-4 py-2.5 font-semibold"
            >
              Back
            </button>
          )}
          {index < STEPS.length - 1 && (
            <button
              type="button"
              onClick={() => void go(STEPS[index + 1]?.id ?? 'submit')}
              className="rounded-xl bg-accent px-5 py-2.5 font-bold text-ink"
              data-testid="step-next"
            >
              Next
            </button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
