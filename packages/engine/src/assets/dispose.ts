import type { Material, Mesh, Object3D, Texture } from 'three';

const isTexture = (value: unknown): value is Texture =>
  typeof value === 'object' && value !== null && (value as Texture).isTexture === true;

export function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) if (isTexture(value)) value.dispose();
  material.dispose();
}

/** Disposes every geometry, material and texture under `root`. Each is disposed once. */
export function disposeObject(root: Object3D): void {
  const seen = new Set<object>();
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const materials = mesh.material ? [mesh.material].flat() : [];
    for (const material of materials) {
      if (seen.has(material)) continue;
      seen.add(material);
      disposeMaterial(material);
    }
  });
}
