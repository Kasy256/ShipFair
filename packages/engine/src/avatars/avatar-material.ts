import { MeshStandardMaterial } from 'three';
import { COLOR_SLOTS, REGION } from './avatar-colors.ts';

/** Per-avatar shader inputs. One object per avatar; every avatar shares one compiled program. */
export interface AvatarUniforms {
  /** 16 linear RGB colours, indexed by `_REGION`. */
  uColors: { value: Float32Array };
  /** Body `_MASK` zone bits to discard (covered by garments). */
  uHiddenMask: { value: number };
  /** Hair `_MASK` bits to discard (under a cap or beanie). Applies to the HAIR region only. */
  uHiddenHairMask: { value: number };
  /** 1 = solid; lower values dither the avatar out (LOD cross-fades). */
  uFade: { value: number };
}

const PROGRAM_KEY = 'shipfair-avatar-1';

const VERTEX_HEAD = /* glsl */ `#include <common>
attribute float _region;
attribute float _mask;
flat varying int vRegion;
flat varying int vMask;`;

const FRAGMENT_HEAD = /* glsl */ `#include <common>
uniform vec3 uColors[${COLOR_SLOTS}];
uniform int uHiddenMask;
uniform int uHiddenHairMask;
uniform float uFade;
flat varying int vRegion;
flat varying int vMask;`;

const FRAGMENT_COLOR = /* glsl */ `int hidden = vRegion == ${REGION.HAIR} ? uHiddenHairMask : uHiddenMask;
if ((vMask & hidden) != 0) discard;
if (uFade < 1.0) {
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (noise > uFade) discard;
}
vec4 diffuseColor = vec4(diffuse * uColors[vRegion], opacity);`;

export function createAvatarUniforms(): AvatarUniforms {
  return {
    uColors: { value: new Float32Array(COLOR_SLOTS * 3).fill(1) },
    uHiddenMask: { value: 0 },
    uHiddenHairMask: { value: 0 },
    uFade: { value: 1 },
  };
}

/**
 * MeshStandardMaterial that colours each vertex from `uColors[_REGION]` and discards fragments
 * whose `_MASK` bits are hidden (ARCHITECTURE.md §4). Each avatar owns its material (so it owns
 * its uniforms), but the program cache key is shared, so all avatars compile one shader.
 */
export function createAvatarMaterial(uniforms: AvatarUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  material.name = 'AVATAR';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_HEAD)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRegion = int(_region + 0.5);\nvMask = int(_mask + 0.5);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_HEAD)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', FRAGMENT_COLOR);
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return material;
}
