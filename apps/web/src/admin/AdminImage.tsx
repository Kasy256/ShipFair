import { useEffect, useState } from 'react';
import { fetchMediaUrl } from './admin-api.ts';

interface AdminImageProps {
  mediaKey: string | null;
  alt: string;
  className: string;
}

/**
 * Booth media for staff. Unreviewed uploads are private, so the image comes through the
 * staff-only media route with the session token, as a blob URL that is revoked on unmount.
 */
export function AdminImage({ mediaKey, alt, className }: AdminImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    if (!mediaKey) return;
    let isCurrent = true;
    let url: string | null = null;
    setSrc(null);
    setHasFailed(false);
    fetchMediaUrl(mediaKey).then(
      (blobUrl) => {
        if (isCurrent) {
          url = blobUrl;
          setSrc(blobUrl);
        } else URL.revokeObjectURL(blobUrl);
      },
      () => isCurrent && setHasFailed(true),
    );
    return () => {
      isCurrent = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [mediaKey]);

  if (!mediaKey || hasFailed) {
    return (
      <div className={`${className} grid place-items-center bg-ink-3 text-muted text-xs`}>
        {mediaKey ? 'Image missing' : 'No image'}
      </div>
    );
  }
  return src ? (
    <img src={src} alt={alt} className={`${className} object-cover`} />
  ) : (
    <div className={`${className} animate-pulse bg-ink-3`} />
  );
}
