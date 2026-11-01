import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import {
  NAME_TAG_ATLAS_COLUMNS,
  NAME_TAG_ATLAS_PX,
  NAME_TAG_ATLAS_ROWS,
  NAME_TAG_HEIGHT_M,
  NAME_TAG_MAX_SCALE,
  NAME_TAG_NEAR_M,
} from '../config.ts';
import { context2d, createCanvas } from '../world/textures.ts';

// Remote players' name tags: names are drawn once into one shared canvas atlas (like booth
// signs) and every tag is an instance of one quad, billboarded in the vertex shader, so all tags
// are one draw call. Signed-in users show their handle in white, guests their guest name in
// grey; a maker near one of their own booths gets a small "maker" badge (cell 0) above the name.

const CELL_W = NAME_TAG_ATLAS_PX / NAME_TAG_ATLAS_COLUMNS;
const CELL_H = NAME_TAG_ATLAS_PX / NAME_TAG_ATLAS_ROWS;
const CELLS = NAME_TAG_ATLAS_COLUMNS * NAME_TAG_ATLAS_ROWS;
const BADGE_CELL = 0;
const FONT = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const FONT_PX = Math.round(CELL_H * 0.62);
const MIN_FONT_PX = Math.round(CELL_H * 0.4);
const PAD_PX = 10;
/** Tag width over height, for the quad (cells are 8:1). */
const ASPECT = CELL_W / CELL_H;
const GUEST_TINT = new Color(0.62, 0.64, 0.68);
const USER_TINT = new Color(1, 1, 1);
const BADGE_TINT = new Color(1, 0.8, 0.3);
/** The badge sits this many tag heights above the name. */
const BADGE_RISE = 1.15;

const VERTEX_HEAD = /* glsl */ `#include <common>
attribute vec2 aCell;
attribute float aFade;
uniform vec2 uCellSize;
uniform float uAspect;
varying float vFade;`;
// Billboard: the instance origin goes through the model-view matrix, the quad is laid out in view
// space, so it always faces the camera. Scale comes from the instance matrix.
const BILLBOARD = /* glsl */ `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float tagScale = length(instanceMatrix[1].xyz);
mvPosition.xy += position.xy * vec2(uAspect, 1.0) * tagScale;
gl_Position = projectionMatrix * mvPosition;`;

const scratch = new Matrix4();
const pos = new Vector3();
const size = new Vector3();
const noRotation = new Quaternion();

export class NameTags {
  readonly mesh: InstancedMesh;
  readonly #canvas = createCanvas(NAME_TAG_ATLAS_PX, NAME_TAG_ATLAS_PX);
  readonly #ctx = context2d(this.#canvas);
  readonly #texture: CanvasTexture;
  readonly #cells: InstancedBufferAttribute;
  readonly #fades: InstancedBufferAttribute;
  readonly #free: number[] = [];
  readonly #capacity: number;
  #count = 0;

  /** `capacity` is the most tags (names plus badges) drawn at once. */
  constructor(capacity: number) {
    this.#capacity = capacity;
    for (let cell = CELLS - 1; cell > BADGE_CELL; cell--) this.#free.push(cell);
    this.#texture = new CanvasTexture(this.#canvas);
    this.#texture.colorSpace = SRGBColorSpace;
    this.#texture.minFilter = LinearFilter;
    this.#texture.generateMipmaps = false;
    this.#draw(BADGE_CELL, 'MAKER', true);

    const geometry = new PlaneGeometry(1, 1);
    this.#cells = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.#fades = new InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
    this.#cells.setUsage(DynamicDrawUsage);
    this.#fades.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCell', this.#cells);
    geometry.setAttribute('aFade', this.#fades);
    const material = new MeshBasicMaterial({
      map: this.#texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    material.name = 'name-tags';
    const cellSize = new Vector2(1 / NAME_TAG_ATLAS_COLUMNS, 1 / NAME_TAG_ATLAS_ROWS);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCellSize = { value: cellSize };
      shader.uniforms.uAspect = { value: ASPECT };
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
    material.customProgramCacheKey = () => 'shipfair-name-tags-1';
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'name-tags';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(capacity * 3).fill(1),
      3,
    );
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10; // after the world, so tags blend over it
    this.mesh.count = 0;
  }

  /** Estimated GPU bytes of the atlas (RGBA, no mips). */
  get bytes(): number {
    return NAME_TAG_ATLAS_PX * NAME_TAG_ATLAS_PX * 4;
  }

  /** Tags drawn last frame. */
  get count(): number {
    return this.#count;
  }

  /** Draws a name into a free cell and returns it, or −1 when the atlas is full. */
  acquire(name: string): number {
    const cell = this.#free.pop();
    if (cell === undefined) return -1;
    this.#draw(cell, name, false);
    return cell;
  }

  release(cell: number): void {
    if (cell <= BADGE_CELL) return;
    this.#ctx.clearRect(...this.#rect(cell));
    this.#free.push(cell);
  }

  begin(): void {
    this.#count = 0;
  }

  /**
   * One tag above (x, y, z), `distance` metres from the camera (tags grow with distance so they
   * stay readable). Allocates nothing.
   */
  add(
    cell: number,
    isGuest: boolean,
    hasBadge: boolean,
    x: number,
    y: number,
    z: number,
    distance: number,
    fade: number,
  ) {
    if (cell < 0) return;
    const scale =
      NAME_TAG_HEIGHT_M * Math.min(Math.max(distance / NAME_TAG_NEAR_M, 1), NAME_TAG_MAX_SCALE);
    this.#put(cell, isGuest ? GUEST_TINT : USER_TINT, x, y, z, scale, fade);
    if (hasBadge)
      this.#put(BADGE_CELL, BADGE_TINT, x, y + scale * BADGE_RISE, z, scale * 0.8, fade);
  }

  end(): void {
    const mesh = this.mesh;
    mesh.count = this.#count;
    mesh.visible = this.#count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.#cells.needsUpdate = true;
    this.#fades.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.#texture.dispose();
    this.mesh.dispose();
  }

  #put(cell: number, tint: Color, x: number, y: number, z: number, scale: number, fade: number) {
    const i = this.#count;
    if (i >= this.#capacity) return;
    this.#count++;
    this.mesh.setMatrixAt(i, scratch.compose(pos.set(x, y, z), noRotation, size.setScalar(scale)));
    this.mesh.setColorAt(i, tint);
    // The canvas has y down, texture v up: row r is at the top, so its v starts near 1.
    const column = cell % NAME_TAG_ATLAS_COLUMNS;
    const row = Math.floor(cell / NAME_TAG_ATLAS_COLUMNS);
    this.#cells.setXY(i, column / NAME_TAG_ATLAS_COLUMNS, 1 - (row + 1) / NAME_TAG_ATLAS_ROWS);
    this.#fades.setX(i, fade);
  }

  #rect(cell: number): [number, number, number, number] {
    const column = cell % NAME_TAG_ATLAS_COLUMNS;
    const row = Math.floor(cell / NAME_TAG_ATLAS_COLUMNS);
    return [column * CELL_W, row * CELL_H, CELL_W, CELL_H];
  }

  /** Name tags are text set by people: drawn with fillText only (never parsed as markup). */
  #draw(cell: number, text: string, isBadge: boolean): void {
    const ctx = this.#ctx;
    const [x, y, w, h] = this.#rect(cell);
    ctx.clearRect(x, y, w, h);
    let font = FONT_PX;
    ctx.font = `600 ${font}px ${FONT}`;
    while (font > MIN_FONT_PX && ctx.measureText(text).width > w - PAD_PX * 2) {
      font--;
      ctx.font = `600 ${font}px ${FONT}`;
    }
    const textW = Math.min(ctx.measureText(text).width, w - PAD_PX * 2);
    const pillW = isBadge ? textW + PAD_PX : textW + PAD_PX * 2;
    const pillX = x + (w - pillW) / 2;
    ctx.fillStyle = isBadge ? 'rgba(120, 72, 0, 0.85)' : 'rgba(10, 12, 20, 0.6)';
    ctx.beginPath();
    ctx.roundRect(pillX, y + 2, pillW, h - 4, (h - 4) / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 1, w - PAD_PX * 2);
    this.#texture.needsUpdate = true;
  }
}
