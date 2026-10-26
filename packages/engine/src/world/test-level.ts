import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  GridHelper,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { PhysicsWorld } from '../physics/world.ts';
import type { LevelRamp, TestLevelLayout } from './test-level-layout.ts';

export interface BuiltLevel {
  readonly root: Object3D[];
  dispose(): void;
}

/** Wedge vertices (x, y, z triples) for a ramp, local to its centre at floor level. */
function rampPoints(ramp: LevelRamp): Float32Array {
  const w = ramp.halfWidth;
  const half = (ramp.z1 - ramp.z0) / 2;
  const h = ramp.height;
  // biome-ignore format: six wedge corners (x, y, z), easier to read on one line
  return new Float32Array([
    -w, 0, -half, w, 0, -half, -w, 0, half, w, 0, half, -w, h, half, w, h, half,
  ]);
}

function rampGeometry(ramp: LevelRamp): BufferGeometry {
  const p = rampPoints(ramp);
  const v = (i: number) => [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0];
  // Triangles (counter-clockwise from outside): slope, back, two sides, bottom.
  const faces = [
    [0, 4, 1],
    [1, 4, 5],
    [2, 3, 4],
    [3, 5, 4],
    [0, 2, 4],
    [1, 5, 3],
    [0, 1, 2],
    [1, 3, 2],
  ];
  const positions = new Float32Array(faces.length * 9);
  faces.forEach((face, f) => {
    face.forEach((index, k) => {
      positions.set(v(index), f * 9 + k * 3);
    });
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Builds the test level's colliders and meshes. All boxes share one InstancedMesh (one draw
 * call); the ramp, pillar and floor grid are one mesh each.
 */
export function buildTestLevel(layout: TestLevelLayout, physics: PhysicsWorld): BuiltLevel {
  const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const unitBox = new BoxGeometry(1, 1, 1);
  const boxes = new InstancedMesh(unitBox, material, layout.boxes.length);
  boxes.name = 'test-level-boxes';
  const m = new Matrix4();
  const q = new Quaternion();
  const center = new Vector3();
  const size = new Vector3();
  const color = new Color();
  layout.boxes.forEach((b, i) => {
    size.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    center.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    boxes.setMatrixAt(i, m.compose(center, q, size));
    boxes.setColorAt(i, color.setHex(b.color));
    physics.addBox(center, { x: size.x / 2, y: size.y / 2, z: size.z / 2 });
  });
  boxes.castShadow = true;
  boxes.receiveShadow = true;
  boxes.computeBoundingSphere();

  const root: Object3D[] = [boxes];
  const geometries: BufferGeometry[] = [unitBox];
  const materials: MeshStandardMaterial[] = [material];

  for (const ramp of layout.ramps) {
    const geometry = rampGeometry(ramp);
    const rampMaterial = new MeshStandardMaterial({ color: ramp.color, roughness: 0.85 });
    const mesh = new Mesh(geometry, rampMaterial);
    const z = (ramp.z0 + ramp.z1) / 2;
    mesh.position.set(ramp.x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    physics.addConvex({ x: ramp.x, y: 0, z }, rampPoints(ramp));
    root.push(mesh);
    geometries.push(geometry);
    materials.push(rampMaterial);
  }

  for (const c of layout.cylinders) {
    const geometry = new CylinderGeometry(c.radius, c.radius, c.halfHeight * 2, 24);
    const pillarMaterial = new MeshStandardMaterial({ color: c.color, roughness: 0.7 });
    const mesh = new Mesh(geometry, pillarMaterial);
    mesh.position.set(c.center[0], c.center[1], c.center[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    physics.addCylinder({ x: c.center[0], y: c.center[1], z: c.center[2] }, c.halfHeight, c.radius);
    root.push(mesh);
    geometries.push(geometry);
    materials.push(pillarMaterial);
  }

  // A 1 m grid makes speed and distance readable while tuning the feel.
  const grid = new GridHelper(60, 60, 0x2b2f3a, 0x5d6270);
  grid.position.y = 0.02; // high enough not to z-fight the floor at distance
  root.push(grid);

  return {
    root,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
      boxes.dispose();
      grid.dispose();
    },
  };
}
