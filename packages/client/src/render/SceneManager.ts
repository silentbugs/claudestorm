import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ARENA,
  LAKE_WATERLINE_FACTOR,
  Rng,
  STORM_START_RADIUS,
  coastRadius,
  groundHeight,
  lakeSurfaceY,
} from '@claudestorm/shared';
import type { AssetLibrary, ModelName } from './assets.js';
import { GrassField } from './Grass.js';
import { Motes } from './Motes.js';
import { PostFX } from './PostFX.js';
import { makeDetailTextures, makeGlowSprite, makeNoiseTexture, type DetailTextures } from './proctex.js';
import { QUALITY_PRESETS, type Quality, type QualityPreset } from './quality.js';
import { SHARED, SHARED_PARS, bindShared } from './shaderlib.js';
import { SkyDome, type SkySettings } from './Sky.js';
import { bakeTerrainData, sampleBiome, sampleHeight, type BiomeSample, type TerrainData } from './TerrainData.js';
import { buildTerrain } from './Terrain.js';
import { applyWaterSettings, makeWaterMaterial, type WaterSettings } from './Water.js';

const SUN_DIR = SHARED.uSunDir.value;

/** Ruined masonry: box obstacles render as clean stone blocks (the sim shape, exactly). */
const STONE_GEO = new THREE.BoxGeometry(1, 1, 1);
const STONE_MATS = [
  new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ color: 0x867f76, roughness: 0.95 }),
];
STONE_MATS[0]!.name = 'stoneA';
STONE_MATS[1]!.name = 'stoneB';

/** Start-screen time-of-day choices. */
export type EnvironmentId = 'day' | 'dusk' | 'night';

interface EnvPreset {
  fog: number;
  fogNear: number;
  fogFar: number;
  sky: SkySettings;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  exposure: number;
  water: WaterSettings;
  puff: number;
  puffOpacity: number;
  motes: { color: number; intensity: number; size: number; rise: number };
  cloudShadow: number;
  wind: number;
}

/** Day is the default — bright and saturated, the Plunderstorm look. */
const ENVIRONMENTS: Record<EnvironmentId, EnvPreset> = {
  day: {
    fog: 0xa7cfe6,
    fogNear: 260,
    fogFar: 900,
    sky: {
      zenith: 0x2a6bd4, horizon: 0xa9d5f0, glow: 0xfff0c8, glowStrength: 0.4,
      disc: 0xfff6e0, discIntensity: 7, discSize: 0.99945,
      cloudColor: 0xffffff, cloudShade: 0xb4c2d6, cloudCover: 0.5, cloudOpacity: 0.92, stars: 0,
    },
    hemiSky: 0xd6e8ff, hemiGround: 0x55763f, hemiIntensity: 1.45,
    sun: 0xfff1d6, sunIntensity: 2.1, exposure: 1.15,
    water: { fog: 0xa7cfe6, deep: 0x0e3f62, shallow: 0x5ec8c2, skyTint: 0x8ec2dd, sunTint: 0xffe2a8 },
    puff: 0xffffff, puffOpacity: 0.9,
    motes: { color: 0xfff0b8, intensity: 0.55, size: 0.08, rise: 0.15 },
    cloudShadow: 0.24,
    wind: 0.35,
  },
  dusk: {
    fog: 0x6d5470,
    fogNear: 220,
    fogFar: 820,
    sky: {
      zenith: 0x1b2656, horizon: 0xe0895c, glow: 0xffb35c, glowStrength: 0.65,
      disc: 0xffc078, discIntensity: 5, discSize: 0.9993,
      cloudColor: 0xf2c5a4, cloudShade: 0x5a4a72, cloudCover: 0.55, cloudOpacity: 0.85, stars: 0.25,
    },
    hemiSky: 0xc4b4ff, hemiGround: 0x4a3830, hemiIntensity: 1.05,
    sun: 0xffd0a0, sunIntensity: 1.9, exposure: 1.08,
    water: { fog: 0x6d5470, deep: 0x0c1e3a, shallow: 0x3f8a92, skyTint: 0x8a6a80, sunTint: 0xffb070 },
    puff: 0xe8c8d0, puffOpacity: 0.85,
    motes: { color: 0xffa050, intensity: 0.9, size: 0.07, rise: 0.4 },
    cloudShadow: 0.2,
    wind: 0.45,
  },
  night: {
    fog: 0x16203a,
    fogNear: 180,
    fogFar: 760,
    sky: {
      zenith: 0x040610, horizon: 0x1c2640, glow: 0x9fb6ff, glowStrength: 0.22,
      disc: 0xe4ecff, discIntensity: 3, discSize: 0.9989,
      cloudColor: 0x2c3654, cloudShade: 0x10141f, cloudCover: 0.4, cloudOpacity: 0.75, stars: 1,
    },
    hemiSky: 0x8ea4d8, hemiGround: 0x141a22, hemiIntensity: 0.7,
    sun: 0xbfd0ff, sunIntensity: 1.1, exposure: 1.0,
    water: { fog: 0x16203a, deep: 0x040a14, shallow: 0x1a3e4c, skyTint: 0x2a3550, sunTint: 0xc0d0ff },
    puff: 0x2a3048, puffOpacity: 0.6,
    motes: { color: 0xc8ff70, intensity: 1.4, size: 0.1, rise: 0.05 },
    cloudShadow: 0.12,
    wind: 0.28,
  },
};

/** How strongly a scattered model rocks in the wind (0 = rigid). */
const SWAY: Partial<Record<ModelName, number>> = {
  tree_oak: 1, tree_fat: 1, tree_tall: 1.1, tree_thin: 1.2, tree_pineDefaultA: 0.8, tree_pineDefaultB: 0.8,
  tree_palm: 1.4, tree_palmTall: 1.5,
  plant_bush: 0.7, plant_bushLarge: 0.6, grass: 1, grass_large: 1,
  flower_redA: 0.9, flower_purpleA: 0.9, flower_yellowA: 0.9,
  mushroom_red: 0.2, mushroom_tanGroup: 0.15,
  'flag-pirate-high': 1.6,
};

/** Owns the Three.js scene, camera, lights, sky, water, terrain, foliage, storm wall, and post pipeline. */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  quality: Quality;
  private preset: QualityPreset;
  private readonly stormWall: THREE.Mesh;
  private readonly stormWallMat: THREE.ShaderMaterial;
  private seaMat!: THREE.ShaderMaterial;
  private lakeMat!: THREE.ShaderMaterial;
  private sea!: THREE.Mesh;
  private readonly lakes: THREE.Mesh[] = [];
  private readonly puffs: { group: THREE.Group; speed: number }[] = [];
  private readonly clock = new THREE.Clock();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky: SkyDome;
  private puffMat!: THREE.MeshStandardMaterial;
  private readonly terrainData: TerrainData;
  private readonly details: DetailTextures;
  readonly noiseTexture: THREE.Texture;
  readonly glowSprite: THREE.Texture;
  private terrain: THREE.Mesh | null = null;
  private grass: GrassField | null = null;
  private post: PostFX | null = null;
  private motes: Motes | null = null;
  private staticMeshes: THREE.Mesh[] = [];
  /** Staging area for static scenery; merged into per-material meshes at the end. */
  private readonly staticStage = new THREE.Group();
  private readonly staticMaterials = new Map<string, THREE.Material>();
  private readonly staticDepth: THREE.MeshDepthMaterial;
  private envId: EnvironmentId = 'day';
  private readonly lowPower: boolean;

  /**
   * `lowPower` (touch/mobile) forces the Low tier's renderer settings: no
   * MSAA, hard shadows, a capped pixel ratio — the priciest per-pixel costs
   * on a phone GPU.
   */
  constructor(container: HTMLElement, private readonly assets: AssetLibrary, lowPower = false, quality: Quality = 'high') {
    this.lowPower = lowPower;
    this.quality = quality;
    this.preset = QUALITY_PRESETS[quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: !lowPower && !this.preset.post, // the post pipeline brings its own MSAA
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(this.preset.maxPixelRatio, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1150);

    // Procedural art, baked once: noise atlas, ground details, the island.
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.noiseTexture = makeNoiseTexture();
    SHARED.uNoise.value = this.noiseTexture;
    this.glowSprite = makeGlowSprite();
    this.details = makeDetailTextures(aniso);
    this.terrainData = bakeTerrainData();
    SHARED.uHeightMap.value = this.terrainData.height;
    SHARED.uTerrainColor.value = this.terrainData.color;
    SHARED.uSplat.value = this.terrainData.splat;

    this.scene.fog = new THREE.Fog(ENVIRONMENTS.day.fog, 260, 900);
    // Anything past the far plane (the water plane's edge, the dome's rim)
    // must resolve to the fog color, never the default black.
    this.scene.background = new THREE.Color(ENVIRONMENTS.day.fog);
    this.sky = new SkyDome();
    this.scene.add(this.sky.mesh);

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.85);
    this.scene.add(this.hemi);
    // The shadow map covers a tight box that follows the player (setFocus)
    // instead of the whole island: far casters skip the shadow pass entirely
    // and the texels land where the fight is.
    this.sun = new THREE.DirectionalLight(0xffe6c0, 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    // Shadows stay readable rather than pitch black: the sky fills them in.
    this.sun.shadow.intensity = 0.82;
    this.scene.add(this.sun, this.sun.target);
    this.setFocus(0, 0);

    // Scenery materials: clones of the kit materials with wind sway wired in.
    this.staticDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    addSway(this.staticDepth);

    this.buildWater();
    this.buildLakes();
    this.buildClouds();

    // Storm wall: turbulent energy shot through with lightning, denser toward the ground.
    this.stormWallMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        ${SHARED_PARS}
        varying vec2 vUv;
        float hash11( float p ) { return fract( sin( p * 127.1 ) * 43758.5453 ); }
        void main() {
          vec2 uv1 = vec2( vUv.x * 12.0 + uTime * 0.04, vUv.y * 1.8 - uTime * 0.07 );
          vec2 uv2 = vec2( vUv.x * 28.0 - uTime * 0.08, vUv.y * 3.5 - uTime * 0.15 );
          float n = texture2D( uNoise, uv1 ).r * 0.6 + texture2D( uNoise, uv2 ).g * 0.4;
          float turb = smoothstep( 0.3, 0.78, n );
          float rise = sin( vUv.y * 24.0 - uTime * 2.4 + vUv.x * 40.0 ) * 0.5 + 0.5;
          float glow = turb * 0.7 + rise * 0.3;
          // Lightning: a random column flashes for a few frames, its bolt
          // shape carved from the fine noise channel; now and then the
          // whole wall pulses.
          float col = floor( vUv.x * 160.0 );
          float tick = floor( uTime * 7.0 );
          float strike = step( 0.985, hash11( col + tick * 0.37 ) );
          float bolt = strike * smoothstep( 0.55, 0.9, texture2D( uNoise, vec2( vUv.x * 160.0, vUv.y * 2.5 + tick ) ).a );
          float pulse = step( 0.965, hash11( tick * 1.7 ) ) * 0.35;
          float vert = 1.0 - vUv.y;
          float alpha = ( 0.28 + glow * 0.45 ) * ( 0.4 + vert * 0.6 ) + bolt * 0.9 + pulse;
          vec3 color = mix( vec3( 0.28, 0.1, 0.55 ), vec3( 0.75, 0.45, 1.0 ), glow );
          color += vec3( 0.85, 0.75, 1.3 ) * bolt * 2.5;
          color += vec3( 0.6, 0.45, 1.0 ) * pulse;
          gl_FragColor = vec4( color, alpha );
        }`,
    });
    bindShared(this.stormWallMat);
    this.stormWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 128, 1, true), this.stormWallMat);
    this.stormWall.position.y = 30;
    this.stormWall.renderOrder = 3;
    this.setStorm(0, 0, STORM_START_RADIUS);
    this.scene.add(this.stormWall);

    this.applyQuality();
    this.setEnvironment('day');

    // Compile every shader up front so the first frames of a match don't hitch.
    this.renderer.compile(this.scene, this.camera);

    window.addEventListener('resize', () => this.resize());
  }

  /** Switch graphics tier at runtime (start-screen setting). */
  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.preset = QUALITY_PRESETS[quality];
    this.applyQuality();
    this.setEnvironment(this.envId);
    this.renderer.compile(this.scene, this.camera);
  }

  /** (Re)build everything the quality tier scales: shadows, ground, grass, foliage, post. */
  private applyQuality(): void {
    const p = this.preset;
    const low = this.lowPower;
    this.renderer.setPixelRatio(Math.min(p.maxPixelRatio, window.devicePixelRatio));
    this.renderer.shadowMap.type = p.softShadows && !low ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const shadowSize = low ? Math.min(1024, p.shadowMap) : p.shadowMap;
    if (this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }

    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.geometry.dispose();
      (this.terrain.material as THREE.Material).dispose();
    }
    this.terrain = buildTerrain(this.terrainData, this.details, {
      segments: p.terrainSegments,
      pbr: p.terrainPbr && !low,
    });
    this.scene.add(this.terrain);

    if (this.grass) {
      this.scene.remove(this.grass.mesh);
      this.grass.dispose();
    }
    this.grass = new GrassField({ radius: p.grassRadius, spacing: p.grassSpacing });
    this.scene.add(this.grass.mesh);

    for (const m of this.staticMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.staticMeshes = [];
    this.buildObstacles();
    this.buildLandmarks();
    this.buildShoreline();
    this.scatterFoliage(p.foliage);
    this.mergeStatics();

    // The sea stays opaque on Low: blending it would be the single biggest
    // fill cost in the frame on a phone. Higher tiers get the soft shoreline.
    this.seaMat.transparent = p.softSea && !low;
    this.seaMat.depthWrite = !this.seaMat.transparent;
    this.seaMat.needsUpdate = true;

    if (this.motes) {
      this.scene.remove(this.motes.mesh);
      this.motes.dispose();
      this.motes = null;
    }
    if (p.motes > 0 && !low) {
      this.motes = new Motes(p.motes, this.glowSprite);
      this.scene.add(this.motes.mesh);
    }

    this.post?.dispose();
    this.post = null;
    if (p.post && !low) {
      this.post = new PostFX(this.renderer, this.scene, this.camera, {
        samples: p.msaaSamples,
        bloomStrength: p.bloomStrength,
      });
    }
  }

  private buildWater(): void {
    this.seaMat = makeWaterMaterial(this.assets.waterNormals, { alpha: 1, transparent: false });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(3800, 3800, 48, 48), this.seaMat);
    this.sea.geometry.rotateX(-Math.PI / 2);
    this.sea.position.y = -0.55;
    this.sea.renderOrder = -2;
    this.sea.frustumCulled = false;
    this.scene.add(this.sea);
  }

  /** Translucent pools filling the lowland bowls up to the shared waterline. */
  private buildLakes(): void {
    this.lakeMat = makeWaterMaterial(this.assets.waterNormals, { alpha: 0.72, transparent: true });
    for (const lake of ARENA.lakes) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(lake.r * LAKE_WATERLINE_FACTOR + 1.5, 40), this.lakeMat);
      disc.geometry.rotateX(-Math.PI / 2);
      disc.position.set(lake.x, lakeSurfaceY(ARENA, lake), lake.z);
      disc.renderOrder = -1;
      this.lakes.push(disc);
      this.scene.add(disc);
    }
  }

  /** Stage a model clone on the terrain; mergeStatics() bakes the stage down. */
  private place(model: THREE.Group, x: number, z: number, rotY = 0, sway = 0): void {
    model.position.set(x, groundHeight(ARENA, x, z), z);
    model.rotation.y = rotY;
    model.userData.sway = sway;
    this.staticStage.add(model);
  }

  private placeModel(name: ModelName, height: number, x: number, z: number, rotY = 0): THREE.Group {
    const model = this.assets.modelAtHeight(name, height);
    this.place(model, x, z, rotY, SWAY[name] ?? 0);
    return model;
  }

  /** The static material for a kit material: a clone with wind sway compiled in. */
  private staticMaterial(source: THREE.Material & { map?: THREE.Texture | null }): THREE.Material {
    const key = `${source.name}|${source.map ? 'tex' : 'flat'}`;
    let mat = this.staticMaterials.get(key);
    if (!mat) {
      mat = source.clone();
      addSway(mat);
      this.staticMaterials.set(key, mat);
    }
    return mat;
  }

  /**
   * Static batching, chunked: scenery merges into one mesh per material per
   * ~95m grid cell. Merging kills draw-call count; chunking keeps frustum
   * culling alive — without it every merged mesh spans the whole island, so
   * looking at your feet still drew every tree, and the shadow pass
   * re-rendered all island geometry into the shadow map every frame.
   * Every vertex carries its sway weight and its model's root, so the
   * merged canopies still rock in the wind around their own trunks.
   */
  private mergeStatics(): void {
    this.staticStage.updateMatrixWorld(true);
    const cell = ARENA.size / 8;
    const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
    const wp = new THREE.Vector3();
    const box = new THREE.Box3();
    for (const root of this.staticStage.children) {
      const sway = (root.userData.sway as number) ?? 0;
      box.setFromObject(root);
      const baseY = box.min.y;
      const span = Math.max(0.01, box.max.y - box.min.y);
      root.getWorldPosition(wp);
      const pivotX = wp.x;
      const pivotZ = wp.z;
      const cellKey = `${Math.floor(wp.x / cell)}|${Math.floor(wp.z / cell)}`;
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const source = o.material as THREE.Material & { map?: THREE.Texture | null };
        const geo = (o.geometry as THREE.BufferGeometry).clone();
        geo.applyMatrix4(o.matrixWorld);
        // Attribute sets must match to merge: uv only matters on textured materials.
        if (!source.map) {
          geo.deleteAttribute('uv');
          geo.deleteAttribute('uv1');
        }
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const swayAttr = new Float32Array(pos.count);
        const pivotAttr = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          const t = Math.max(0, Math.min(1, (pos.getY(i) - baseY) / span));
          swayAttr[i] = sway * t * t;
          pivotAttr[i * 2] = pivotX;
          pivotAttr[i * 2 + 1] = pivotZ;
        }
        geo.setAttribute('aSway', new THREE.BufferAttribute(swayAttr, 1));
        geo.setAttribute('aPivot', new THREE.BufferAttribute(pivotAttr, 2));
        const material = this.staticMaterial(source);
        const key = `${source.name}|${source.map ? 'tex' : 'flat'}|${cellKey}`;
        let group = groups.get(key);
        if (!group) {
          group = { material, geos: [] };
          groups.set(key, group);
        }
        group.geos.push(geo);
      });
    }
    for (const { material, geos } of groups.values()) {
      const merged = mergeGeometries(geos, false);
      const batches = merged ? [merged] : geos; // mismatched attributes: keep unmerged
      if (merged) for (const g of geos) g.dispose();
      for (const geometry of batches) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = this.staticDepth;
        this.scene.add(mesh);
        this.staticMeshes.push(mesh);
      }
    }
    this.staticStage.clear();
  }

  /** Keep the sun's shadow box centered on the action. */
  setFocus(x: number, z: number): void {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x, 0, z).addScaledVector(SUN_DIR, 260);
  }

  /** Characters near the camera that should bend the grass this frame. */
  setGrassPushers(pushers: { x: number; z: number; radius: number; strength: number }[]): void {
    this.grass?.setPushers(pushers);
  }

  /**
   * Obstacle dressing with real models (visual only — the sim collides with
   * the raw circles): the map's `look` hint picks cliff blocks, trees (palms
   * near the shore), or rocks.
   */
  private buildObstacles(): void {
    const treePick: ModelName[] = [
      'tree_oak', 'tree_fat', 'tree_pineDefaultA', 'tree_tall', 'tree_thin', 'tree_pineDefaultB',
    ];
    const palmPick: ModelName[] = ['tree_palm', 'tree_palmTall'];
    const rockPick: ModelName[] = ['rock_tallA', 'rock_tallB', 'rock_tallC'];

    ARENA.obstacles.forEach((ob, i) => {
      if (ob.kind === 'box') {
        // Ruin walls and rubble: a stone block matching the collision exactly.
        const stone = new THREE.Mesh(STONE_GEO, STONE_MATS[i % 2]!);
        stone.scale.set(ob.hx * 2, ob.height, ob.hz * 2);
        stone.position.y = ob.height / 2 - 0.15; // settle into the ground
        const holder = new THREE.Group();
        holder.add(stone);
        this.place(holder, ob.x, ob.z);
        return;
      }
      const rot = i * 2.39; // deterministic "random" facing
      const look = ob.look ?? (ob.height >= 5 ? 'tree' : 'rock');
      if (look === 'none') return; // collision-only footprint under landmark dressing
      if (look === 'tree') {
        const nearShore =
          Math.hypot(ob.x, ob.z) >
          coastRadius(ARENA.coastR ?? ARENA.size / 2, Math.atan2(ob.x, ob.z)) - 50;
        const name = nearShore ? palmPick[i % 2]! : treePick[i % treePick.length]!;
        // Canopy overshoots the collision cylinder; trunks match its radius.
        const tree = this.placeModel(name, ob.height * 1.45, ob.x, ob.z, rot);
        tree.scale.x *= 1.2;
        tree.scale.z *= 1.2;
      } else {
        this.placeModel(rockPick[i % 3]!, ob.height * 1.1, ob.x, ob.z, rot);
      }
    });
  }

  /** Set dressing that makes each milestone area readable from a distance. */
  private buildLandmarks(): void {
    for (const lm of ARENA.landmarks) {
      switch (lm.kind) {
        case 'wreck': {
          // The beached hulk sits over its collision rock, listing toward the sea.
          this.placeModel('ship-wreck', 12, lm.x, lm.z, -0.5);
          this.placeModel('flag-pirate-high', 6, lm.x - 10, lm.z + 12, 2.4);
          this.placeModel('campfire_logs', 0.8, lm.x - 12, lm.z - 5, 0);
          this.placeModel('boat-row-small', 1.4, lm.x + 12, lm.z - 12, 1.1);
          this.placeModel('crate', 1.0, lm.x + 8, lm.z + 4, 0.3);
          this.placeModel('barrel', 1.0, lm.x + 9.5, lm.z + 5.2, 0);
          this.placeModel('cannon', 1.5, lm.x - 6, lm.z + 14, 1.9);
          break;
        }
        case 'spire': {
          // A watchtower on the island's highest point — visible from anywhere.
          this.placeModel('tower-watch', 13, lm.x, lm.z, 0.6);
          this.placeModel('flag-pirate-high', 6, lm.x + 7, lm.z + 2, -0.4);
          this.placeModel('crate', 0.9, lm.x - 5, lm.z + 3, 0.8);
          break;
        }
        case 'stonering': {
          this.placeModel('campfire_logs', 0.9, lm.x, lm.z + 2.5, 0);
          break;
        }
        case 'grove': {
          this.placeModel('log_stack', 1.1, lm.x + 7, lm.z + 6, 0.9);
          this.placeModel('stump_old', 0.8, lm.x - 8, lm.z + 3, 0);
          this.placeModel('mushroom_tanGroup', 0.6, lm.x + 4, lm.z - 7, 0.4);
          break;
        }
        case 'pit': {
          // Old digging gear abandoned at the lip.
          this.placeModel('log_stack', 1.0, lm.x + lm.r + 3, lm.z + 4, 0.4);
          this.placeModel('campfire_logs', 0.8, lm.x - lm.r - 4, lm.z - 2, 0);
          this.placeModel('crate', 0.9, lm.x + lm.r + 1, lm.z - 3, 1.1);
          break;
        }
        case 'ravine': {
          // A camp abandoned at the trench floor.
          this.placeModel('campfire_logs', 0.9, lm.x + 2, lm.z - 3, 0);
          this.placeModel('stump_old', 0.8, lm.x - 4, lm.z + 2, 1.2);
          this.placeModel('barrel', 0.9, lm.x + 4, lm.z + 1, 0.5);
          break;
        }
        case 'hamlet': {
          // What's left of village life among the ruins.
          this.placeModel('campfire_logs', 0.9, lm.x + 2, lm.z + 2, 0);
          this.placeModel('barrel', 1.0, lm.x - 6, lm.z - 2, 0.7);
          this.placeModel('log_stack', 1.0, lm.x + 6, lm.z - 6, 2.1);
          this.placeModel('crate', 0.9, lm.x - 3, lm.z + 7, 0.2);
          this.placeModel('castle-wall', 3.2, lm.x + 20, lm.z - 4, 1.2);
          break;
        }
        case 'barrow': {
          this.placeModel('stump_old', 0.8, lm.x + 12, lm.z + 4, 0.5);
          this.placeModel('mushroom_red', 0.5, lm.x - 6, lm.z + 6, 0);
          break;
        }
        case 'passage': {
          // A smuggler's cache stash marks the midpoint below.
          this.placeModel('campfire_logs', 0.8, lm.x - 2, lm.z + 2, 0);
          this.placeModel('crate', 0.9, lm.x + 2, lm.z - 2, 0.6);
          break;
        }
      }
    }
  }

  /** Rowboats beached on the sand. */
  private buildShoreline(): void {
    const base = ARENA.coastR ?? ARENA.size / 2;
    for (const [angle, rot] of [
      [-1.1, 0.8],
      [3.0, -1.9],
    ] as const) {
      const r = coastRadius(base, angle) - 10;
      this.placeModel('boat-row-small', 1.4, Math.sin(angle) * r, Math.cos(angle) * r, rot);
    }
  }

  /**
   * Undergrowth: bushes, flower clumps, mushrooms under the trees, and small
   * boulders scattered where the biome bake says they belong. Purely
   * decorative (no collision), deterministic, and merged with the rest of
   * the scenery so the whole island costs a few dozen draw calls.
   */
  private scatterFoliage(fraction: number): void {
    const rng = new Rng(0xf01a6e);
    const data = this.terrainData;
    const biome: BiomeSample = { grass: 1, dry: 0, rock: 0, sand: 0, submerged: false, r: 0, g: 0, b: 0 };
    const coast = ARENA.coastR ?? ARENA.size / 2;
    const half = ARENA.size / 2;
    const step = 1.6;
    const sampleAt = (x: number, z: number): BiomeSample | null => {
      if (Math.hypot(x, z) > coastRadius(coast, Math.atan2(x, z)) - 14) return null;
      const h = sampleHeight(data, x, z);
      const hx = sampleHeight(data, x + step, z) - sampleHeight(data, x - step, z);
      const hz = sampleHeight(data, x, z + step) - sampleHeight(data, x, z - step);
      const slope = Math.min(1, Math.hypot(hx, hz) / (2 * step));
      sampleBiome(x, z, h, slope, biome);
      if (biome.submerged || slope > 0.5) return null;
      return biome;
    };
    const clearOfObstacles = (x: number, z: number, margin: number): boolean => {
      for (const ob of ARENA.obstacles) {
        const r = ob.kind === 'circle' ? ob.r : Math.max(ob.hx, ob.hz);
        if (Math.hypot(x - ob.x, z - ob.z) < r + margin) return false;
      }
      for (const p of ARENA.chests) if (Math.hypot(x - p.x, z - p.z) < 2.6) return false;
      for (const p of ARENA.scrolls) if (Math.hypot(x - p.x, z - p.z) < 2.2) return false;
      for (const p of ARENA.items) if (Math.hypot(x - p.x, z - p.z) < 2.2) return false;
      return true;
    };
    const tries = (n: number, fn: () => void): void => {
      for (let i = 0; i < Math.round(n * fraction); i++) fn();
    };

    // Bushes on the meadow.
    tries(520, () => {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      const b = sampleAt(x, z);
      if (!b || b.grass + b.dry < 0.55 || !clearOfObstacles(x, z, 1.2)) return;
      const big = rng.next() < 0.3;
      this.placeModel(big ? 'plant_bushLarge' : 'plant_bush', rng.range(0.9, 1.5) * (big ? 1.25 : 1), x, z, rng.range(0, Math.PI * 2));
    });
    // Flower clumps.
    const flowers: ModelName[] = ['flower_redA', 'flower_purpleA', 'flower_yellowA'];
    tries(110, () => {
      const cx = rng.range(-half, half);
      const cz = rng.range(-half, half);
      const b = sampleAt(cx, cz);
      if (!b || b.grass < 0.6) return;
      const kind = flowers[rng.int(0, flowers.length)]!;
      for (let k = 0; k < 5; k++) {
        const x = cx + rng.range(-3, 3);
        const z = cz + rng.range(-3, 3);
        if (!sampleAt(x, z) || !clearOfObstacles(x, z, 0.6)) continue;
        this.placeModel(kind, rng.range(0.45, 0.7), x, z, rng.range(0, Math.PI * 2));
      }
    });
    // Mushrooms in the shade of the trees.
    const trees = ARENA.obstacles.filter((o) => o.kind === 'circle' && (o.look ?? (o.height >= 5 ? 'tree' : 'rock')) === 'tree');
    tries(170, () => {
      const tree = trees[rng.int(0, trees.length)];
      if (!tree || tree.kind !== 'circle') return;
      const a = rng.range(0, Math.PI * 2);
      const d = tree.r + rng.range(0.8, 3.2);
      const x = tree.x + Math.sin(a) * d;
      const z = tree.z + Math.cos(a) * d;
      if (!sampleAt(x, z) || !clearOfObstacles(x, z, 0.5)) return;
      this.placeModel(rng.next() < 0.5 ? 'mushroom_red' : 'mushroom_tanGroup', rng.range(0.35, 0.6), x, z, a);
    });
    // Small boulders on dry and rocky ground.
    const rocks: ModelName[] = ['rock_largeA', 'rock_largeB', 'rock_largeC'];
    tries(260, () => {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      const b = sampleAt(x, z);
      if (!b || b.rock + b.dry + b.sand * 0.5 < 0.3 + rng.next() * 0.5 || !clearOfObstacles(x, z, 1.5)) return;
      this.placeModel(rocks[rng.int(0, rocks.length)]!, rng.range(0.5, 1.3), x, z, rng.range(0, Math.PI * 2));
    });
    // Fallen logs and stumps in the copses.
    tries(70, () => {
      const tree = trees[rng.int(0, trees.length)];
      if (!tree || tree.kind !== 'circle') return;
      const a = rng.range(0, Math.PI * 2);
      const d = tree.r + rng.range(2.5, 6);
      const x = tree.x + Math.sin(a) * d;
      const z = tree.z + Math.cos(a) * d;
      if (!sampleAt(x, z) || !clearOfObstacles(x, z, 1.0)) return;
      this.placeModel(rng.next() < 0.5 ? 'log' : 'stump_round', rng.range(0.5, 0.8), x, z, rng.range(0, Math.PI * 2));
    });
  }

  /** Puffy low-poly clouds drifting high over the island, on the same wind as the sky's cloud layer. */
  private buildClouds(): void {
    const rng = new Rng(0xc10d);
    this.puffMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      transparent: true,
      opacity: 0.9,
      flatShading: true,
      emissive: 0xffffff,
      emissiveIntensity: 0.12,
    });
    for (let c = 0; c < 16; c++) {
      const group = new THREE.Group();
      const puffs = 3 + (c % 3);
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.puffMat);
        puff.position.set(rng.range(-14, 14), rng.range(-2, 2), rng.range(-6, 6));
        puff.scale.set(rng.range(7, 13), rng.range(3, 4.5), rng.range(5, 8));
        puff.rotation.y = rng.range(0, Math.PI);
        group.add(puff);
      }
      group.position.set(rng.range(-700, 700), rng.range(95, 150), rng.range(-700, 700));
      this.puffs.push({ group, speed: rng.range(1.5, 4) });
      this.scene.add(group);
    }
  }

  /** Retint sky, fog, lights, water, clouds, and motes to a time-of-day preset. */
  setEnvironment(id: EnvironmentId): void {
    const env = ENVIRONMENTS[id] ?? ENVIRONMENTS.day;
    this.envId = id;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(env.fog);
    fog.near = env.fogNear;
    fog.far = env.fogFar;
    (this.scene.background as THREE.Color).setHex(env.fog);
    this.sky.apply(env.sky);
    this.hemi.color.setHex(env.hemiSky);
    this.hemi.groundColor.setHex(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity;
    this.sun.color.setHex(env.sun);
    this.sun.intensity = env.sunIntensity;
    applyWaterSettings(this.seaMat, env.water, env.fogNear, env.fogFar);
    applyWaterSettings(this.lakeMat, env.water, env.fogNear, env.fogFar);
    this.renderer.toneMappingExposure = env.exposure;
    this.puffMat.color.setHex(env.puff);
    this.puffMat.emissive.setHex(env.puff);
    this.puffMat.opacity = env.puffOpacity;
    this.motes?.apply(env.motes.color, env.motes.intensity, env.motes.size, env.motes.rise);
    SHARED.uCloudShadow.value.z = env.cloudShadow;
    SHARED.uWind.value.z = env.wind;
  }

  setStorm(x: number, z: number, radius: number): void {
    this.stormWall.position.x = x;
    this.stormWall.position.z = z;
    this.stormWall.scale.set(Math.max(0.01, radius), 1, Math.max(0.01, radius));
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post?.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    SHARED.uTime.value = t;
    this.sky.mesh.position.copy(this.camera.position);
    this.grass?.update(this.camera.position.x, this.camera.position.z);
    // Puffs ride the same wind the sky's cloud layer scrolls on.
    const drift = SHARED.uCloudShadow.value;
    const dx = (drift.x / drift.w) * dt;
    const dz = (drift.y / drift.w) * dt;
    for (const puff of this.puffs) {
      const k = puff.speed / 2.5;
      puff.group.position.x += dx * k;
      puff.group.position.z += dz * k;
      if (puff.group.position.x > 800) puff.group.position.x = -800;
      if (puff.group.position.z > 800) puff.group.position.z = -800;
    }
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

/** Wire the shared wind into a material: vertices rock around their model's root by their sway weight. */
function addSway(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    bindShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${SHARED_PARS}
        attribute float aSway;
        attribute vec2 aPivot;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec2 w = windAt( aPivot ) * 0.9;
          float flutter = sin( uTime * 1.9 + aPivot.x * 0.31 + aPivot.y * 0.17 ) * 0.06;
          transformed.xz += ( w + vec2( flutter, - flutter ) ) * aSway;
          transformed.y -= dot( w, w ) * 0.25 * aSway;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'sway';
}
