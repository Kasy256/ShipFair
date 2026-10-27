import {
  DataTexture,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';

/** Glow parts render above the bloom threshold (BLOOM_THRESHOLD 1.1) so signs and rings glow. */
const GLOW_INTENSITY = 2.2;
const ROUGHNESS = 0.8;

/**
 * The one shared 16-colour palette texture. Nearest filtering and no mipmaps, or neighbouring
 * squares bleed into each other. glTF UVs put v = 0 at the top, so no flip.
 */
export function preparePalette(texture: Texture): Texture {
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** Loads the palette from the manifest url; a mid-grey 1×1 stands in when it's missing. */
export async function loadPalette(url: string | null): Promise<Texture> {
  if (url) {
    try {
      return preparePalette(await new TextureLoader().loadAsync(url));
    } catch (error) {
      console.warn('Palette texture failed to load; using grey.', error);
    }
  }
  return preparePalette(new DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1));
}

/**
 * Materials shared by every booth part and prop: PALETTE (the texture), ACCENT (tinted per
 * instance) and GLOW (unlit, tinted per instance, bright enough to bloom). The `ao` variants
 * multiply by baked AO vertex colours (the kit has them, props don't).
 */
export class PaletteMaterials {
  readonly palette: MeshStandardMaterial;
  readonly paletteAo: MeshStandardMaterial;
  readonly accent: MeshStandardMaterial;
  readonly accentAo: MeshStandardMaterial;
  readonly glow: MeshBasicMaterial;
  readonly texture: Texture;

  constructor(texture: Texture) {
    this.texture = texture;
    this.palette = new MeshStandardMaterial({ map: texture, roughness: ROUGHNESS, metalness: 0 });
    this.paletteAo = new MeshStandardMaterial({
      map: texture,
      roughness: ROUGHNESS,
      metalness: 0,
      vertexColors: true,
    });
    // instanceColor multiplies into vColor, so AO × accent tint comes from one attribute pair.
    this.accent = new MeshStandardMaterial({ roughness: ROUGHNESS, metalness: 0 });
    this.accentAo = new MeshStandardMaterial({
      roughness: ROUGHNESS,
      metalness: 0,
      vertexColors: true,
    });
    this.glow = new MeshBasicMaterial();
    this.glow.color.setScalar(GLOW_INTENSITY);
    this.palette.name = 'PALETTE';
    this.paletteAo.name = 'PALETTE_AO';
    this.accent.name = 'ACCENT';
    this.accentAo.name = 'ACCENT_AO';
    this.glow.name = 'GLOW';
  }

  dispose(): void {
    this.palette.dispose();
    this.paletteAo.dispose();
    this.accent.dispose();
    this.accentAo.dispose();
    this.glow.dispose();
    this.texture.dispose();
  }
}
