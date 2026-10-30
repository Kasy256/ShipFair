import { useState } from 'react';
import { type FormMedia, type MediaItem, SCREENSHOTS_MAX } from './booth-form.ts';
import { ImagePicker } from './ImagePicker.tsx';

interface StepMediaProps {
  media: FormMedia;
  onChange: (media: FormMedia) => void;
  logoError: string | null;
}

interface ThumbProps {
  item: MediaItem;
  alt: string;
  onRemove: () => void;
}

function Thumb({ item, alt, onRemove }: ThumbProps) {
  return (
    <li className="relative overflow-hidden rounded-xl bg-ink-3">
      {item.src ? (
        <img src={item.src} alt={alt} className="block h-24 w-auto" />
      ) : (
        <p className="grid h-24 w-32 place-items-center text-muted text-xs">Uploaded</p>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 rounded-lg bg-ink/80 px-2 py-0.5 text-xs hover:bg-ink"
        aria-label={`Remove ${alt}`}
      >
        Remove
      </button>
    </li>
  );
}

export function StepMedia({ media, onChange, logoError }: StepMediaProps) {
  const [isCropped, setIsCropped] = useState(true);
  const isFull = media.screenshots.length >= SCREENSHOTS_MAX;
  const addShot = (shot: MediaItem) =>
    onChange({
      ...media,
      screenshots: media.screenshots.some((s) => s.key === shot.key)
        ? media.screenshots
        : [...media.screenshots, shot].slice(0, SCREENSHOTS_MAX),
    });

  return (
    <div className="grid gap-6">
      <section aria-labelledby="media-logo">
        <h3 id="media-logo" className="font-semibold">
          Logo <span className="font-normal text-muted text-sm">(required)</span>
        </h3>
        {media.logo && (
          <ul className="mt-2 flex" data-testid="logo-thumb">
            <Thumb
              item={media.logo}
              alt="logo"
              onRemove={() => onChange({ ...media, logo: null })}
            />
          </ul>
        )}
        <div className="mt-2">
          <ImagePicker
            kind="logo"
            label={media.logo ? 'Replace logo' : 'Add logo'}
            hint="Cut to a square and resized to 512×512. At least 256×256, under 10 MB."
            onAdd={(logo) => onChange({ ...media, logo })}
            testId="logo-input"
          />
        </div>
        {logoError && (
          <p role="alert" className="mt-1 text-red-300 text-sm">
            {logoError}
          </p>
        )}
      </section>
      <section aria-labelledby="media-shots">
        <h3 id="media-shots" className="font-semibold">
          Screenshots{' '}
          <span className="font-normal text-muted text-sm">
            ({media.screenshots.length} of {SCREENSHOTS_MAX}, optional)
          </span>
        </h3>
        {media.screenshots.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="screenshot-list">
            {media.screenshots.map((shot, i) => (
              <Thumb
                key={shot.key}
                item={shot}
                alt={`screenshot ${i + 1}`}
                onRemove={() =>
                  onChange({ ...media, screenshots: media.screenshots.filter((s) => s !== shot) })
                }
              />
            ))}
          </ul>
        )}
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isCropped}
            onChange={(e) => setIsCropped(e.target.checked)}
          />
          Crop to 16:9 (the shape of booth screens)
        </label>
        <div className="mt-2">
          <ImagePicker
            kind="screenshot"
            label="Add screenshot"
            hint={
              isFull
                ? 'That is the maximum of 5.'
                : 'At least 640 px wide; resized to at most 1280.'
            }
            isCropped={isCropped}
            isDisabled={isFull}
            onAdd={addShot}
            testId="screenshot-input"
          />
        </div>
      </section>
    </div>
  );
}
