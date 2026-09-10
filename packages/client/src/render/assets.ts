import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Every model shipped in public/assets/models (see ASSETS.md for credits). */
export const MODEL_NAMES = [
  // nature kit
  'tree_oak', 'tree_fat', 'tree_tall', 'tree_thin',
  'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_palm', 'tree_palmTall',
  'tree_detailed', 'tree_default', 'tree_plateau', 'tree_blocks', 'tree_cone',
  'tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA_detailed', 'tree_oak_fall', 'tree_detailed_fall',
  'rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_tallA', 'rock_tallB', 'rock_tallC',
  'rock_smallA', 'rock_smallB', 'rock_smallFlatA',
  'stone_largeA', 'stone_largeC', 'stone_tallB', 'stone_tallE',
  'cliff_block_rock', 'cliff_blockDiagonal_rock', 'cliff_blockHalf_rock', 'cliff_large_rock', 'cliff_rock',
  'cliff_cornerLarge_rock', 'cliff_cave_rock', 'cliff_top_rock',
  'statue_obelisk', 'statue_column', 'statue_columnDamaged', 'statue_head', 'statue_ring', 'statue_block',
  'stump_round', 'stump_old', 'stump_oldTall', 'log', 'log_large', 'log_stack', 'campfire_logs', 'campfire_stones',
  'grass', 'grass_large', 'grass_leafsLarge', 'plant_bush', 'plant_bushLarge', 'plant_bushDetailed', 'plant_bushLargeTriangle',
  'flower_redA', 'flower_purpleA', 'flower_yellowA',
  'mushroom_red', 'mushroom_tanGroup', 'mushroom_redTall', 'mushroom_tanTall',
  'tent_detailedOpen', 'tent_smallClosed', 'canoe', 'sign', 'pot_large', 'fence_simple', 'fence_simpleHigh',
  'path_stoneCircle', 'hanging_moss', 'lily_large', 'lily_small',
  'crops_wheatStageB', 'crops_cornStageC', 'crop_pumpkin',
  // pirate kit
  'chest', 'crate', 'crate-bottles', 'barrel', 'bottle', 'cannon-ball', 'structure', 'structure-roof', 'structure-platform',
  'structure-fence', 'structure-platform-dock', 'structure-platform-dock-small', 'platform-planks',
  'tower-watch', 'tower-base', 'tower-complete-large', 'tower-complete-small',
  'castle-wall', 'castle-gate', 'castle-window',
  'ship-wreck', 'ship-pirate-medium', 'boat-row-small', 'mast', 'cannon', 'flag-pirate-high', 'flag-pennant',
  'palm-detailed-straight', 'palm-detailed-bend', 'rocks-sand-a', 'rocks-sand-b', 'patch-sand-foliage',
  'tool-shovel', 'hole',
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

/**
 * The nature kit ships in Kenney's teal-and-orange palette; the island is
 * painted in warm meadow greens and earth, so every flat kit material is
 * remapped by name to sit in that palette (the pirate kit's colormap texture
 * is left alone). Rocks get real stone instead of the kit's white default.
 */
const KIT_PALETTE: Record<string, number> = {
  leafsGreen: 0x3f9e3c,
  leafsDark: 0x2a7d49,
  grass: 0x4da545,
  dirt: 0x8a6647,
  woodBark: 0x8a583a,
  woodBarkDark: 0x6c4531,
  wood: 0xa06f49,
  woodDark: 0x78503a,
  woodInner: 0xe9d0a9,
  _defaultMat: 0xf1e9dc,
  colorTan: 0xf0c48a,
  colorRed: 0xe2463e,
  colorRedDark: 0xa83030,
  colorPurple: 0xa27fff,
  colorYellow: 0xffc63a,
  stone: 0x9c978e,
  stoneDark: 0x6b675f,
  leafsFall: 0xe0862f,
  woodBirch: 0xe9e1d2,
};
const STONE = 0x8f8a82;
const WHEAT = 0xe6c45c;

/**
 * All downloaded art, loaded once up front. Models are kept as templates;
 * callers take clones (geometry/materials stay shared, so clones are cheap).
 */
export class AssetLibrary {
  private constructor(
    private readonly models: Map<ModelName, { scene: THREE.Group; size: THREE.Vector3 }>,
    readonly waterNormals: THREE.Texture,
  ) {}

  static async load(): Promise<AssetLibrary> {
    const gltfLoader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    const models = new Map<ModelName, { scene: THREE.Group; size: THREE.Vector3 }>();

    const [waterNormals] = await Promise.all([
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
          // The nature kit exports every material fully metallic. A metal
          // has no diffuse response, so without an environment map it lights
          // only where the sun glints and renders black everywhere else —
          // the "black blocks" that canopies and rocks used to turn into on
          // their shade side. These are painted wood, leaf, and stone.
          mat.metalness = 0;
          mat.roughness = 0.9;
          if (mat.map) {
            // The pirate kit's shared colormap: crisp at grazing angles.
            mat.map.anisotropy = 8;
            mat.map.minFilter = THREE.LinearMipmapLinearFilter;
            return;
          }
          const isRock = name.startsWith('rock') || name.startsWith('cliff') || name.startsWith('statue');
          const remap =
            mat.name === '_defaultMat'
              ? isRock ? STONE : name.startsWith('crops') ? WHEAT : KIT_PALETTE[mat.name]
              : KIT_PALETTE[mat.name];
          if (remap !== undefined) mat.color.setHex(remap);
          if (isRock && mat.name === 'grass') mat.color.setHex(0x6fae52); // moss cap
          if (name.startsWith('cliff') && mat.name === 'dirt') mat.color.setHex(0x8c7a64); // weathered stone, not chocolate
          mat.color.getHSL(hsl);
          mat.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), hsl.l);
          // Foliage glows faintly with its own color, painterly-style, so a
          // canopy seen from below keeps its green.
          if (mat.name.startsWith('leafs') || mat.name === 'grass') {
            mat.emissive.copy(mat.color);
            mat.emissiveIntensity = 0.1;
          }
        });
        const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
        models.set(name, { scene, size });
      }),
    ]);
    waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
    return new AssetLibrary(models, waterNormals);
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
