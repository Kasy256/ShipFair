import type { District } from '@shipfair/shared';
import { useFormContext, useWatch } from 'react-hook-form';
import type { BoothFormInput } from './booth-form.ts';
import { FormField, inputClass } from './FormField.tsx';

const TAGLINE = { min: 10, max: 90 } as const;

interface StepBasicsProps {
  districts: readonly District[];
  /** Live booths: name, district and pricing are fixed; edits go to a revision. */
  isRevision: boolean;
  urlWarning: string | null;
  onUrlBlur: () => void;
}

export function StepBasics({ districts, isRevision, urlWarning, onUrlBlur }: StepBasicsProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<BoothFormInput>();
  const tagline = useWatch<BoothFormInput, 'tagline'>({ name: 'tagline' }) ?? '';
  const length = tagline.trim().length;
  const counterTone =
    length < TAGLINE.min || length > TAGLINE.max ? 'text-amber-300' : 'text-muted';
  const url = register('url');

  return (
    <div className="grid gap-4">
      <FormField
        id="booth-name"
        label="Name"
        hint="2–40 characters, as on your site."
        error={errors.name?.message}
      >
        <input
          id="booth-name"
          className={inputClass}
          autoComplete="off"
          disabled={isRevision}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby="booth-name-msg"
          {...register('name')}
        />
      </FormField>
      <FormField
        id="booth-tagline"
        label="Tagline"
        hint="What it does, in one line."
        error={errors.tagline?.message}
      >
        <input
          id="booth-tagline"
          className={inputClass}
          autoComplete="off"
          aria-invalid={errors.tagline ? true : undefined}
          aria-describedby="booth-tagline-msg booth-tagline-count"
          {...register('tagline')}
        />
        <p
          id="booth-tagline-count"
          className={`mt-1 text-right text-xs ${counterTone}`}
          data-testid="tagline-count"
        >
          {length} / {TAGLINE.max} (at least {TAGLINE.min})
        </p>
      </FormField>
      <FormField
        id="booth-url"
        label="Link"
        hint="Where “Try it” goes. https only."
        error={errors.url?.message}
        warning={urlWarning}
      >
        <input
          id="booth-url"
          type="url"
          inputMode="url"
          className={inputClass}
          aria-invalid={errors.url ? true : undefined}
          aria-describedby="booth-url-msg"
          {...url}
          onBlur={(e) => {
            void url.onBlur(e);
            onUrlBlur();
          }}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="booth-district" label="District" error={errors.districtId?.message}>
          <select
            id="booth-district"
            className={inputClass}
            disabled={isRevision}
            aria-invalid={errors.districtId ? true : undefined}
            aria-describedby="booth-district-msg"
            {...register('districtId')}
          >
            <option value={0}>Pick one…</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id="booth-pricing"
          label="Pricing"
          hint="Optional."
          error={errors.pricing?.message}
        >
          <select
            id="booth-pricing"
            className={inputClass}
            disabled={isRevision}
            {...register('pricing')}
          >
            <option value="">Not saying</option>
            <option value="free">Free</option>
            <option value="freemium">Freemium</option>
            <option value="paid">Paid</option>
            <option value="open-source">Open source</option>
          </select>
        </FormField>
      </div>
    </div>
  );
}
