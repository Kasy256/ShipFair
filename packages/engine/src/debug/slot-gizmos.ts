import type { BuiltSlot } from '@shipfair/shared';
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

const RECT_COLOR = 0xffd166;
const POINT_COLOR = 0x06d6a0;
const LABEL_PX = { w: 256, h: 48 };
const LABEL_WIDTH_M = 1.4;
const LABEL_ABOVE_M = 0.35;
const CROSS_M = 0.3;

function label(text: string): { sprite: Sprite; dispose(): void } {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_PX.w;
  canvas.height = LABEL_PX.h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, LABEL_PX.w, LABEL_PX.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 10, LABEL_PX.h / 2);
  }
  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new Sprite(material);
  sprite.scale.set(LABEL_WIDTH_M, (LABEL_WIDTH_M * LABEL_PX.h) / LABEL_PX.w, 1);
  sprite.renderOrder = 10;
  return {
    sprite,
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}

/**
 * Outlines for `SLOT_*` empties: rectangles for logo, screens and sign (the empty's scale is the
 * rectangle), a cross for spawn and maker points, each with its name. For /dev/assets.
 */
export function slotGizmos(slots: readonly BuiltSlot[]): { object: Group; dispose(): void } {
  const object = new Group();
  const rect = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
  );
  const s = CROSS_M;
  const cross = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute([-s, 0, 0, s, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, 0, s * 2, 0], 3),
  );
  const rectMaterial = new LineBasicMaterial({ color: RECT_COLOR, depthTest: false });
  const pointMaterial = new LineBasicMaterial({ color: POINT_COLOR, depthTest: false });
  const labels: { dispose(): void }[] = [];
  const m = new Matrix4();
  const at = new Vector3();
  for (const slot of slots) {
    m.fromArray(slot.matrix);
    const isRect = slot.w > 0;
    const line = isRect ? new LineLoop(rect, rectMaterial) : new LineSegments(cross, pointMaterial);
    if (isRect) line.applyMatrix4(m);
    else line.position.setFromMatrixPosition(m);
    line.renderOrder = 9;
    object.add(line);
    const tag = label(slot.name.replace('SLOT_', ''));
    tag.sprite.position.copy(at.setFromMatrixPosition(m)).y += isRect
      ? slot.h / 2 + LABEL_ABOVE_M
      : LABEL_ABOVE_M * 2;
    object.add(tag.sprite);
    labels.push(tag);
  }
  return {
    object,
    dispose() {
      rect.dispose();
      cross.dispose();
      rectMaterial.dispose();
      pointMaterial.dispose();
      for (const l of labels) l.dispose();
      object.removeFromParent();
    },
  };
}
