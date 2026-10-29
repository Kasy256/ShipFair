import type { AvatarPreview } from '@shipfair/engine';
import type { AvatarStyleV2 } from '@shipfair/shared';
import { useEffect, useRef, useState } from 'react';
import { loadEngineModule } from '../../lib/engine-loader.ts';
import { engineBus } from '../../state/engine-bus.ts';

interface AvatarPreviewCanvasProps {
  style: AvatarStyleV2;
}

type Status = 'loading' | 'ready' | 'error';

/**
 * The editor's 3D preview: its own small canvas and renderer (AvatarPreview), created when the
 * editor opens and disposed when it closes. The avatar waves on open; drag to turn it.
 */
export function AvatarPreviewCanvas({ style }: AvatarPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<AvatarPreview | null>(null);
  // The latest style, so a preview that finishes loading after a change starts from it.
  const latestStyle = useRef(style);
  latestStyle.current = style;
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let isCurrent = true;
    let preview: AvatarPreview | undefined;
    loadEngineModule()
      .then((mod) => mod.AvatarPreview.create(canvas, engineBus, latestStyle.current))
      .then((created) => {
        preview = created;
        if (!isCurrent) return created.dispose();
        previewRef.current = created;
        created.setStyle(latestStyle.current);
        if (import.meta.env.MODE !== 'production') window.__shipfairPreview = created;
        setStatus('ready');
      })
      .catch((error: unknown) => {
        console.error('Avatar preview failed', error);
        if (isCurrent) setStatus('error');
      });
    return () => {
      isCurrent = false;
      previewRef.current = null;
      if (import.meta.env.MODE !== 'production' && window.__shipfairPreview === preview) {
        delete window.__shipfairPreview;
      }
      preview?.dispose();
    };
  }, []);

  useEffect(() => {
    previewRef.current?.setStyle(style);
  }, [style]);

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-ink-3">
      <canvas
        ref={canvasRef}
        data-testid="avatar-preview"
        data-status={status}
        className="block h-full w-full touch-none"
        aria-label="Preview of your avatar. Drag to turn it."
      />
      {status === 'loading' && (
        <p className="absolute inset-0 grid place-items-center text-muted text-sm">
          Loading preview…
        </p>
      )}
      {status === 'error' && (
        <p
          role="alert"
          className="absolute inset-0 grid place-items-center p-4 text-center text-sm"
        >
          The 3D preview couldn't start (WebGL may be off). Your choices still save.
        </p>
      )}
    </div>
  );
}
