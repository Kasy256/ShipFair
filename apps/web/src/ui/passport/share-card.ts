import { APP_NAME } from '@shipfair/shared';
import type { StampInfo } from './stamp-info.ts';

// "Share my passport" (prompt 13): a 1200×630 card drawn on a canvas, shared as a PNG where the
// platform can share files, otherwise the /u/:handle link is copied (or, for a guest with no
// handle, the image downloads).

const W = 1200;
const H = 630;
const PER_ROW = 9;
const R = 46;

export interface PassportCard {
  title: string;
  subtitle: string;
  stamps: readonly StampInfo[];
  footer: string;
}

export function drawPassportCard(canvas: HTMLCanvasElement, card: PassportCard): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#141a2e');
  bg.addColorStop(1, '#0b3d47');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffb547';
  ctx.fillRect(60, 60, 8, 96);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f5f3ee';
  ctx.font = '800 56px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(card.title, 90, 112, W - 150);
  ctx.fillStyle = '#b9bfd3';
  ctx.font = '500 30px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(card.subtitle, 90, 156, W - 150);

  card.stamps.slice(0, PER_ROW * 3).forEach((stamp, i) => {
    const x = 120 + (i % PER_ROW) * 120;
    const y = 270 + Math.floor(i / PER_ROW) * 115;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((((i * 37) % 17) - 8) * (Math.PI / 180));
    ctx.fillStyle = `${stamp.color}33`;
    ctx.strokeStyle = stamp.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R - 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = stamp.color;
    ctx.font = '900 34px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(stamp.glyph, 0, 2);
    ctx.restore();
  });

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#00e5c7';
  ctx.font = '700 28px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(`${APP_NAME} · ${card.footer}`, 90, H - 50, W - 150);
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No PNG'))), 'image/png'),
  );
}

export type ShareOutcome = 'shared' | 'copied' | 'downloaded' | 'cancelled';

/** Shares the PNG if the platform can, else copies `link`, else downloads the image. */
export async function sharePassport(blob: Blob, link: string | null): Promise<ShareOutcome> {
  const file = new File([blob], 'passport.png', { type: 'image/png' });
  const data: ShareData = { files: [file], title: `My ${APP_NAME} passport` };
  if (link) data.url = link;
  if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      console.warn('Share failed; falling back', error);
    }
  }
  if (link) {
    await navigator.clipboard.writeText(link);
    return 'copied';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'passport.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
