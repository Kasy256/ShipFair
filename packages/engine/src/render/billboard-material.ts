import { MeshBasicMaterial, type Texture, Vector2 } from 'three';

// Camera-facing quads from one canvas atlas, all in one draw call: name tags, chat bubbles and
// heart bursts. Each instance picks its atlas cell (`aCell`, the cell's lower-left uv) and fades
// (`aFade`); the instance matrix gives position and scale, and the quad is laid out in view space
// so it always faces the camera.

const VERTEX_HEAD = /* glsl */ `#include <common>
attribute vec2 aCell;
attribute float aFade;
uniform vec2 uCellSize;
uniform float uAspect;
varying float vFade;`;
const BILLBOARD = /* glsl */ `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float tagScale = length(instanceMatrix[1].xyz);
mvPosition.xy += position.xy * vec2(uAspect, 1.0) * tagScale;
gl_Position = projectionMatrix * mvPosition;`;

export interface BillboardMaterialOptions {
  map: Texture;
  name: string;
  /** Atlas cells across and down. */
  columns: number;
  rows: number;
  /** Quad width over height (the cell's aspect). */
  aspect: number;
  /** Unique per variant, so three never shares a program between them. */
  cacheKey: string;
}

/** The instanced geometry must carry `aCell` (vec2) and `aFade` (float) attributes. */
export function createBillboardMaterial(opts: BillboardMaterialOptions): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    map: opts.map,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  material.name = opts.name;
  const cellSize = new Vector2(1 / opts.columns, 1 / opts.rows);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCellSize = { value: cellSize };
    shader.uniforms.uAspect = { value: opts.aspect };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_HEAD)
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvMapUv = aCell + uv * uCellSize;\nvFade = aFade;',
      )
      .replace('#include <project_vertex>', BILLBOARD);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace(
        '#include <alphatest_fragment>',
        'diffuseColor.a *= vFade;\nif (diffuseColor.a < 0.02) discard;',
      );
  };
  material.customProgramCacheKey = () => opts.cacheKey;
  return material;
}

/** The lower-left uv of atlas cell `cell` (row 0 at the top of the canvas, v up in the texture). */
export function cellUv(cell: number, columns: number, rows: number, out: Vector2): Vector2 {
  const column = cell % columns;
  const row = Math.floor(cell / columns);
  return out.set(column / columns, 1 - (row + 1) / rows);
}
