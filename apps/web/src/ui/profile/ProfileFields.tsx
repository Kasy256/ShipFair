import type { LinkKind } from '@shipfair/shared';
import type { ReactNode } from 'react';
import {
  type DraftErrors,
  LINK_KINDS,
  type ProfileDraft,
  useHandleCheck,
} from './profile-draft.ts';

interface ProfileFieldsProps {
  draft: ProfileDraft;
  errors: DraftErrors;
  onChange: (draft: ProfileDraft) => void;
}

const LINKS: Record<LinkKind, { label: string; placeholder: string }> = {
  reddit: { label: 'Reddit', placeholder: 'u/yourname' },
  x: { label: 'X', placeholder: '@yourname' },
  github: { label: 'GitHub', placeholder: 'yourname' },
  site: { label: 'Website', placeholder: 'https://example.com' },
};

const input =
  'mt-1 w-full rounded-xl bg-ink px-3 py-2 text-paper ring-1 ring-white/15 placeholder:text-muted/60 aria-[invalid=true]:ring-red-400';

interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}

function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="font-semibold text-sm">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="mt-1 text-red-300 text-sm">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-msg`} className="mt-1 text-muted text-sm">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Handle (checked live), display name and optional links. Validation shows per field. */
export function ProfileFields({ draft, errors, onChange }: ProfileFieldsProps) {
  const check = useHandleCheck(draft.handle);
  const handleError =
    errors.handle ??
    (check.status === 'invalid' || check.status === 'taken'
      ? (check.message ?? undefined)
      : undefined);
  return (
    <div className="grid gap-4">
      <Field
        id="profile-handle"
        label="Handle"
        hint={
          <span aria-live="polite">
            {check.message ?? '3–20 lowercase letters, digits or _. Shown on your name tag.'}
          </span>
        }
        error={handleError}
      >
        <div className="relative">
          <span aria-hidden="true" className="absolute top-3 left-3 text-muted">
            @
          </span>
          <input
            id="profile-handle"
            name="handle"
            value={draft.handle}
            onChange={(e) => onChange({ ...draft, handle: e.target.value })}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={20}
            aria-invalid={handleError !== undefined}
            aria-describedby="profile-handle-msg"
            className={`${input} pl-7`}
          />
        </div>
      </Field>
      <Field
        id="profile-display-name"
        label="Display name"
        hint="Up to 32 characters. Shown in booth panels."
        error={errors.displayName}
      >
        <input
          id="profile-display-name"
          name="displayName"
          value={draft.displayName}
          onChange={(e) => onChange({ ...draft, displayName: e.target.value })}
          autoComplete="nickname"
          maxLength={64}
          aria-invalid={errors.displayName !== undefined}
          aria-describedby="profile-display-name-msg"
          className={input}
        />
      </Field>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-semibold text-sm">Links (optional, public)</legend>
        {LINK_KINDS.map((kind) => (
          <Field
            key={kind}
            id={`profile-link-${kind}`}
            label={LINKS[kind].label}
            error={errors[kind]}
          >
            <input
              id={`profile-link-${kind}`}
              name={kind}
              value={draft.links[kind]}
              placeholder={LINKS[kind].placeholder}
              onChange={(e) =>
                onChange({ ...draft, links: { ...draft.links, [kind]: e.target.value } })
              }
              inputMode={kind === 'site' ? 'url' : 'text'}
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={errors[kind] !== undefined}
              aria-describedby={`profile-link-${kind}-msg`}
              className={input}
            />
          </Field>
        ))}
      </fieldset>
    </div>
  );
}
