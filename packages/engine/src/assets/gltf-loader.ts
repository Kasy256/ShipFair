import type { WebGLRenderer } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { AssetLoader } from './asset-manager.ts';

/**
 * GLTFLoader with meshopt decoding (all built files are meshopt-compressed) and KTX2 textures.
 * The Basis transcoder is self-hosted: with no transcoder path, KTX2Loader resolves it with
 * `new URL(..., import.meta.url)`, so Vite emits hashed copies on our own origin (no CDN, no
 * second copy in public/). Its workers start on the first KTX2 file only.
 */
export function createGltfLoader(renderer: WebGLRenderer): AssetLoader {
  const ktx2 = new KTX2Loader().detectSupport(renderer);
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  return {
    load: (url) => gltf.loadAsync(url),
    dispose: () => ktx2.dispose(),
  };
}
