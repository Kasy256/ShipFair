import type { BoothPreview, BoothPreviewContent } from '@shipfair/engine';
import { useEffect, useRef, useState } from 'react';
import { loadEngineModule } from '../../lib/engine-loader.ts';
import { engineBus } from '../../state/engine-bus.ts';

interface BoothPreviewCanvasProps {
  content: BoothPreviewContent;
}

type Status = 'loading' | 'ready' | 'error';

/**
 * The submit form's 3D booth: the real stall shell for the chosen district theme with the uploaded
 * logo and screenshots (BoothPreview). Created on mount, disposed on unmount; drag to turn it.
 * Each mount makes its own <canvas> (see AvatarPreviewCanvas for why).
 */
export function BoothPreviewCanvas({ content }: BoothPreviewCanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<BoothPreview | null>(null);
  const latest = useRef(content);
  latest.current = content;
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full touch-none';
    box.prepend(canvas);
    let isCurrent = true;
    let preview: BoothPreview | undefined;
    const initial = latest.current;
    loadEngineModule()
      .then((mod) => mod.BoothPreview.create(canvas, engineBus, initial))
      .then(async (created) => {
        preview = created;
        if (!isCurrent) return created.dispose();
        previewRef.current = created;
        if (latest.current !== initial) await created.setContent(latest.current);
        if (import.meta.env.MODE !== 'production') window.__shipfairBoothPreview = created;
        setStatus('ready');
      })
      .catch((error: unknown) => {
        console.error('Booth preview failed', error);
        if (isCurrent) setStatus('error');
      });
    return () => {
      isCurrent = false;
      previewRef.current = null;
      if (import.meta.env.MODE !== 'production' && window.__shipfairBoothPreview === preview) {
        delete window.__shipfairBoothPreview;
      }
      preview?.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    previewRef.current?.setContent(content).catch((error: unknown) => {
      console.error('Booth preview update failed', error);
    });
  }, [content]);

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label="Preview of your booth in the city. Drag to turn it."
      data-testid="booth-preview"
      data-status={status}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-ink-3"
    >
      {status === 'loading' && (
        <p className="absolute inset-0 grid place-items-center text-muted text-sm">
          Building your booth…
        </p>
      )}
      {status === 'error' && (
        <p
          role="alert"
          className="absolute inset-0 grid place-items-center p-4 text-center text-sm"
        >
          The 3D preview couldn't start (WebGL may be off). You can still submit.
        </p>
      )}
    </div>
  );
}
