import type { BoothMedia } from '@shipfair/shared';
import { type KeyboardEvent, useState } from 'react';
import { mediaUrl } from '../lib/booth-links.ts';

interface ScreenshotCarouselProps {
  boothName: string;
  media: readonly BoothMedia[];
  mediaHost: string | null;
}

/**
 * One screenshot (or video) at a time with Previous/Next buttons. The region is focusable and
 * takes ← and →, and announces "2 of 3" as slides change (WAI carousel pattern, no autoplay).
 */
export function ScreenshotCarousel({ boothName, media, mediaHost }: ScreenshotCarouselProps) {
  const [index, setIndex] = useState(0);
  const slides = media.flatMap((m) => {
    const src = mediaUrl(mediaHost, m.key);
    return src ? [{ ...m, src }] : [];
  });
  const count = slides.length;
  const slide = slides[Math.min(index, count - 1)];
  if (!slide) return null;

  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else return;
    e.preventDefault();
  };
  const position = `${index + 1} of ${count}`;
  const arrow =
    'absolute top-1/2 -translate-y-1/2 rounded-full bg-ink/80 px-3 py-1 text-lg font-bold hover:bg-ink';

  return (
    <section
      aria-roledescription="carousel"
      aria-label={`${boothName} screenshots`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the carousel region takes arrow keys, so it must be focusable.
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative mt-4 overflow-hidden rounded-xl bg-ink-3"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: the WAI-ARIA carousel pattern marks each slide as a group. */}
      <div
        role="group"
        aria-roledescription="slide"
        aria-label={position}
        aria-live="polite"
        className="flex aspect-video items-center justify-center"
      >
        {slide.type === 'video' ? (
          <video
            key={slide.src}
            src={slide.src}
            controls
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
          >
            <track kind="captions" />
          </video>
        ) : (
          <img
            key={slide.src}
            src={slide.src}
            alt={`${boothName}, screenshot ${position}`}
            width={slide.w}
            height={slide.h}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain"
          />
        )}
      </div>
      {count > 1 && (
        <>
          <button type="button" className={`${arrow} left-2`} onClick={() => go(-1)}>
            <span aria-hidden="true">‹</span>
            <span className="sr-only">Previous screenshot</span>
          </button>
          <button type="button" className={`${arrow} right-2`} onClick={() => go(1)}>
            <span aria-hidden="true">›</span>
            <span className="sr-only">Next screenshot</span>
          </button>
          <p
            className="absolute right-2 bottom-2 rounded bg-ink/80 px-2 text-xs"
            aria-hidden="true"
          >
            {position}
          </p>
        </>
      )}
    </section>
  );
}
