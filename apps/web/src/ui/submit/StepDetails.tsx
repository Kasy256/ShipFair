import { useFormContext, useWatch } from 'react-hook-form';
import type { BoothFormInput } from './booth-form.ts';
import { FormField, inputClass } from './FormField.tsx';

const DESCRIPTION_MAX = 600;

const LINKS = [
  { key: 'github', label: 'GitHub', placeholder: 'yourname' },
  { key: 'x', label: 'X', placeholder: 'yourname' },
  { key: 'reddit', label: 'Reddit', placeholder: 'yourname' },
  { key: 'site', label: 'Website', placeholder: 'https://example.com' },
] as const;

interface StepDetailsProps {
  /** Live booth edits change only the booth; maker links stay on the profile page. */
  isRevision: boolean;
}

export function StepDetails({ isRevision }: StepDetailsProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<BoothFormInput>();
  const description = useWatch<BoothFormInput, 'description'>({ name: 'description' });
  const length = typeof description === 'string' ? description.length : 0;
  return (
    <div className="grid gap-5">
      <FormField
        id="booth-description"
        label="Description"
        hint={`${length} / ${DESCRIPTION_MAX}. Optional: what it does, who it is for, what is new.`}
        error={errors.description?.message}
      >
        <textarea
          id="booth-description"
          rows={6}
          maxLength={DESCRIPTION_MAX}
          className={inputClass}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby="booth-description-msg"
          {...register('description')}
        />
      </FormField>
      {!isRevision && (
        <fieldset>
          <legend className="font-semibold">Maker links</legend>
          <p className="text-muted text-sm">
            From your profile, shown as “Made by” on every booth of yours. Changes here update it.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {LINKS.map(({ key, label, placeholder }) => (
              <FormField
                key={key}
                id={`link-${key}`}
                label={label}
                error={errors.links?.[key]?.message}
              >
                <input
                  id={`link-${key}`}
                  className={inputClass}
                  placeholder={placeholder}
                  autoComplete="off"
                  aria-invalid={errors.links?.[key] ? true : undefined}
                  aria-describedby={`link-${key}-msg`}
                  {...register(`links.${key}`)}
                />
              </FormField>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
