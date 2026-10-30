import type { UploadKind } from '@shipfair/shared';
import { type ChangeEvent, useId, useState } from 'react';
import { uploadImage } from '../../lib/booth-api.ts';
import { prepareImage } from '../../lib/images.ts';
import { accessToken } from '../../state/use-auth-sync.ts';
import { boothErrorText } from '../errors.ts';
import type { MediaItem } from './booth-form.ts';

interface ImagePickerProps {
  kind: UploadKind;
  label: string;
  hint: string;
  /** Screenshots only: cut to 16:9 (the shape booth screens show). */
  isCropped?: boolean;
  isDisabled?: boolean;
  onAdd: (item: MediaItem) => void;
  testId: string;
}

/**
 * Picks an image, prepares it (crop, resize, WebP) and uploads it at once, so later steps only
 * keep keys. Errors say what to fix ("Logo must be at least 256×256"); nothing else changes.
 */
export function ImagePicker({
  kind,
  label,
  hint,
  isCropped,
  isDisabled,
  onAdd,
  testId,
}: ImagePickerProps) {
  const id = useId();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // picking the same file again should run again
    if (!file) return;
    setError(null);
    setIsBusy(true);
    try {
      const image = await prepareImage(file, kind, isCropped);
      const token = await accessToken();
      if (!token) throw new Error('signed_out');
      const key = await uploadImage(token, kind, image);
      onAdd({
        key,
        w: image.w,
        h: image.h,
        blob: image.blob,
        src: URL.createObjectURL(image.blob),
      });
    } catch (err) {
      setError(boothErrorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div>
      <label
        htmlFor={id}
        className={`inline-block cursor-pointer rounded-xl bg-ink-3 px-4 py-2.5 font-semibold focus-within:ring-2 focus-within:ring-accent hover:bg-ink ${
          isDisabled || isBusy ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        {isBusy ? 'Uploading…' : label}
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="sr-only"
          disabled={isDisabled || isBusy}
          onChange={(e) => void pick(e)}
          aria-describedby={`${id}-msg`}
          data-testid={testId}
        />
      </label>
      <p
        id={`${id}-msg`}
        className={`mt-1 text-sm ${error ? 'text-red-300' : 'text-muted'}`}
        role={error ? 'alert' : undefined}
      >
        {error ?? hint}
      </p>
    </div>
  );
}
