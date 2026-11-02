import { FileLoader, type WebGLRenderer } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { AssetLoader } from './asset-manager.ts';

const GLB_MAGIC = 0x46546c67; // 'glTF', little-endian
const GLB_HEADER_BYTES = 20; // file header (12) + the JSON chunk's length and type (8)

/** True when a .glb's JSON chunk names KHR_texture_basisu (it has KTX2 textures). */
export function usesKtx2(glb: ArrayBuffer): boolean {
  if (glb.byteLength < GLB_HEADER_BYTES) return false;
  const view = new DataView(glb);
  if (view.getUint32(0, true) !== GLB_MAGIC) return false;
  const jsonBytes = Math.min(view.getUint32(12, true), glb.byteLength - GLB_HEADER_BYTES);
  const json = new TextDecoder().decode(new Uint8Array(glb, GLB_HEADER_BYTES, jsonBytes));
  return json.includes('"KHR_texture_basisu"');
}

/**
 * GLTFLoader with meshopt decoding (all built files are meshopt-compressed) and KTX2 textures.
 * KTX2Loader, with its zstd decoder (~25 kB gzipped), is imported the first time a file actually
 * has KTX2 textures, so the first load doesn't pay for it (prompt 14). The Basis transcoder is
 * self-hosted: with no transcoder path, KTX2Loader resolves it with `new URL(...,
 * import.meta.url)`, so Vite emits hashed copies on our own origin (no CDN). Its workers start on
 * the first KTX2 file only.
 */
export function createGltfLoader(renderer: WebGLRenderer): AssetLoader {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files = new FileLoader().setResponseType('arraybuffer');
  let ktx2: Promise<KTX2Loader> | undefined;
  const withKtx2 = (): Promise<KTX2Loader> => {
    ktx2 ??= import('three/addons/loaders/KTX2Loader.js').then(({ KTX2Loader }) => {
      const loader = new KTX2Loader().detectSupport(renderer);
      gltf.setKTX2Loader(loader);
      return loader;
    });
    return ktx2;
  };
  return {
    async load(url) {
      const data = (await files.loadAsync(url)) as ArrayBuffer;
      if (usesKtx2(data)) await withKtx2();
      return gltf.parseAsync(data, url.slice(0, url.lastIndexOf('/') + 1));
    },
    dispose: () => {
      void ktx2?.then((loader) => loader.dispose());
    },
  };
}
