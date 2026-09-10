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
 * The nature kit ships in Kenney's teal-and-orange palette; the island is
 * painted in warm meadow greens and earth, so every flat kit material is
 * remapped by name to sit in that palette (the pirate kit's colormap texture
 * is left alone). Rocks get real stone instead of the kit's white default.
 */
const KIT_PALETTE: Record<string, number> = {
  leafsGreen: 0x4fb24a,
  leafsDark: 0x2f8c52,
  grass: 0x5db44e,
  dirt: 0x8d6a4a,
  woodBark: 0x8a583a,
  woodBarkDark: 0x6c4531,
  wood: 0xa06f49,
  woodDark: 0x78503a,
  woodInner: 0xe9d0a9,
  _defaultMat: 0xf1e9dc,
  colorTan: 0xf0c48a,
  colorRed: 0xe2463e,
  colorPurple: 0xa27fff,
  colorYellow: 0xffc63a,
};
const STONE = 0x9b9590;

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
        const seen = new Set<THREE.Material>();
        const hsl = { h: 0, s: 0, l: 0 };
        scene.traverse((o) => {
          o.castShadow = true;
          o.receiveShadow = true;
          if (!(o instanceof THREE.Mesh)) return;
          // Push the flat kit colors toward WoW's saturated hand-painted look.
          const mat = o.material as THREE.MeshStandardMaterial;
          if (seen.has(mat)) return;
          seen.add(mat);
          if (mat.map) {
            // The pirate kit's shared colormap: crisp at grazing angles.
            mat.map.anisotropy = 8;
            mat.map.minFilter = THREE.LinearMipmapLinearFilter;
            return;
          }
          const isRock = name.startsWith('rock') || name.startsWith('cliff');
          const remap = isRock && mat.name === '_defaultMat' ? STONE : KIT_PALETTE[mat.name];
          if (remap !== undefined) mat.color.setHex(remap);
          if (isRock && mat.name === 'grass') mat.color.setHex(0x6fae52); // moss cap
          mat.color.getHSL(hsl);
          mat.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(1, hsl.l * 1.05));
          mat.roughness = 0.9;
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
