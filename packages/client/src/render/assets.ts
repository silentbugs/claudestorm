import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Every model shipped in public/assets/models (see ASSETS.md for credits). */
export const MODEL_NAMES = [
  // nature kit
  'tree_oak', 'tree_fat', 'tree_tall', 'tree_thin',
  'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_palm', 'tree_palmTall',
  'rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_tallA', 'rock_tallB', 'rock_tallC',
  'stump_round', 'stump_old', 'log', 'log_stack', 'campfire_logs',
  'grass', 'grass_large', 'plant_bush', 'plant_bushLarge',
  'flower_redA', 'flower_purpleA', 'flower_yellowA', 'mushroom_red', 'mushroom_tanGroup',
  // pirate kit
  'chest', 'crate', 'barrel', 'structure', 'tower-watch', 'tower-base', 'castle-wall',
  'ship-wreck', 'boat-row-small', 'cannon', 'flag-pirate-high',
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

/**
 * All downloaded art, loaded once up front. Models are kept as templates;
 * callers take clones (geometry/materials stay shared, so clones are cheap).
 */
export class AssetLibrary {
  private constructor(
    private readonly models: Map<ModelName, { scene: THREE.Group; size: THREE.Vector3 }>,
    readonly grassTexture: THREE.Texture,
    readonly waterNormals: THREE.Texture,
  ) {}

  static async load(): Promise<AssetLibrary> {
    const gltfLoader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    const models = new Map<ModelName, { scene: THREE.Group; size: THREE.Vector3 }>();

    const [grassTexture, waterNormals] = await Promise.all([
      texLoader.loadAsync('/assets/textures/grass.jpg'),
      texLoader.loadAsync('/assets/textures/waternormals.jpg'),
      ...MODEL_NAMES.map(async (name) => {
        const gltf = await gltfLoader.loadAsync(`/assets/models/${name}.glb`);
        const scene = gltf.scene;
        scene.traverse((o) => {
          o.castShadow = true;
          o.receiveShadow = true;
        });
        const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
        models.set(name, { scene, size });
      }),
    ]);
    grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.colorSpace = THREE.SRGBColorSpace;
    waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
    return new AssetLibrary(models, grassTexture, waterNormals);
  }

  /** A fresh clone of the model, shadows already enabled on the template. */
  model(name: ModelName): THREE.Group {
    return this.entry(name).scene.clone(true);
  }

  /** A clone uniformly scaled so its height (bounding-box Y) matches. */
  modelAtHeight(name: ModelName, height: number): THREE.Group {
    const { scene, size } = this.entry(name);
    const clone = scene.clone(true);
    clone.scale.setScalar(height / Math.max(0.001, size.y));
    return clone;
  }

  /** Native bounding-box size of the template. */
  size(name: ModelName): THREE.Vector3 {
    return this.entry(name).size;
  }

  /**
   * The model flattened into (geometry, material) pairs with node transforms
   * baked in — feedstock for InstancedMesh foliage.
   */
  meshParts(name: ModelName): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
    const root = this.entry(name).scene;
    root.updateMatrixWorld(true);
    const parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const geometry = (o.geometry as THREE.BufferGeometry).clone();
        geometry.applyMatrix4(o.matrixWorld);
        parts.push({ geometry, material: o.material as THREE.Material });
      }
    });
    return parts;
  }

  private entry(name: ModelName): { scene: THREE.Group; size: THREE.Vector3 } {
    const entry = this.models.get(name);
    if (!entry) throw new Error(`model not loaded: ${name}`);
    return entry;
  }
}
