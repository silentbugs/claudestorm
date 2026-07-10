import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA, Rng, STORM_START_RADIUS, coastRadius, groundHeight } from '@claudestorm/shared';
import type { AssetLibrary, ModelName } from './assets.js';

const SUN_DIR = new THREE.Vector3(0.55, 0.5, 0.32).normalize();

/** Deterministic smooth value noise in [0, 1] — patchiness for the ground. */
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const v = (z - zi) * (z - zi) * (3 - 2 * (z - zi));
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Start-screen time-of-day choices. */
export type EnvironmentId = 'day' | 'dusk' | 'night';

interface EnvPreset {
  fog: number;
  zenith: number;
  horizon: number;
  glow: number;
  glowStrength: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  waterDeep: number;
  waterSky: number;
  exposure: number;
  cloud: number;
  cloudOpacity: number;
}

/** Day is the default — bright and saturated, the Plunderstorm look. */
const ENVIRONMENTS: Record<EnvironmentId, EnvPreset> = {
  day: {
    fog: 0x9cc2dd, zenith: 0x2660c2, horizon: 0xaadcf2, glow: 0xfff2cc, glowStrength: 0.35,
    hemiSky: 0xcfe5ff, hemiGround: 0x3d5a34, hemiIntensity: 0.95, sun: 0xfff2d8, sunIntensity: 1.8,
    waterDeep: 0x0d3852, waterSky: 0x80b2cc, exposure: 1.12, cloud: 0xffffff, cloudOpacity: 0.85,
  },
  dusk: {
    fog: 0x453e58, zenith: 0x1a2447, horizon: 0x8c6b85, glow: 0xffb861, glowStrength: 0.5,
    hemiSky: 0xbfd4ff, hemiGround: 0x30281e, hemiIntensity: 0.85, sun: 0xffe6c0, sunIntensity: 1.7,
    waterDeep: 0x0a1c33, waterSky: 0x5c5c7a, exposure: 1.05, cloud: 0xd9dce8, cloudOpacity: 0.82,
  },
  night: {
    fog: 0x141a2c, zenith: 0x050810, horizon: 0x1a2138, glow: 0x9fb6ff, glowStrength: 0.25,
    hemiSky: 0x8fa8d8, hemiGround: 0x101418, hemiIntensity: 0.55, sun: 0xbdd2ff, sunIntensity: 0.95,
    waterDeep: 0x03080f, waterSky: 0x26304d, exposure: 1.0, cloud: 0x2a3048, cloudOpacity: 0.6,
  },
};

const FOG_COLOR = ENVIRONMENTS.day.fog;

/** Owns the Three.js scene, camera, lights, sky, water, arena geometry, and storm wall. */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly stormWall: THREE.Mesh;
  private readonly stormWallMat: THREE.ShaderMaterial;
  private readonly waterMat: THREE.ShaderMaterial;
  private readonly clouds: { group: THREE.Group; speed: number }[] = [];
  private readonly clock = new THREE.Clock();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private sky!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  private cloudMat!: THREE.MeshStandardMaterial;
  /** Staging area for static scenery; merged into per-material meshes at the end. */
  private readonly staticStage = new THREE.Group();

  constructor(container: HTMLElement, private readonly assets: AssetLibrary) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      1150,
    );

    this.scene.fog = new THREE.Fog(FOG_COLOR, 280, 920);
    // Anything past the far plane (the water plane's edge, the dome's rim)
    // must resolve to the fog color, never the default black.
    this.scene.background = new THREE.Color(FOG_COLOR);
    this.buildSky();

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.85);
    this.scene.add(this.hemi);
    // The shadow map covers a tight box that follows the player (setFocus)
    // instead of the whole island: far casters skip the shadow pass entirely
    // and the texels land where the fight is.
    this.sun = new THREE.DirectionalLight(0xffe6c0, 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.far = 420;
    this.scene.add(this.sun, this.sun.target);
    this.setFocus(0, 0);

    this.buildGround();
    this.waterMat = this.buildWater();
    this.buildLakes();
    this.buildObstacles();
    this.buildLandmarks();
    this.buildShoreline();
    this.mergeStatics();
    this.buildClouds();

    // Storm wall: scrolling energy bands, denser toward the ground.
    this.stormWallMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float bands = sin(vUv.x * 80.0 + uTime * 1.6 + sin(vUv.y * 9.0 + uTime) * 1.8) * 0.5 + 0.5;
          float rise = sin(vUv.y * 24.0 - uTime * 2.4 + vUv.x * 40.0) * 0.5 + 0.5;
          float glow = bands * 0.6 + rise * 0.4;
          float vert = 1.0 - vUv.y;                    // fades with height
          float alpha = (0.3 + glow * 0.45) * (0.45 + vert * 0.55);
          vec3 col = mix(vec3(0.42, 0.18, 0.8), vec3(0.78, 0.5, 1.0), glow);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.stormWall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 60, 128, 1, true),
      this.stormWallMat,
    );
    this.stormWall.position.y = 30;
    this.setStorm(0, 0, STORM_START_RADIUS);
    this.scene.add(this.stormWall);
    this.setEnvironment('day');

    // Compile every shader up front so the first frames of a match don't hitch.
    this.renderer.compile(this.scene, this.camera);

    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Gradient sky dome with a warm glow around the sun's side of the horizon.
   * The dome follows the camera every frame: a world-centered dome bigger than
   * the far plane gets clipped when you walk away from the island's middle,
   * leaving a black hole in the sky that tracks the camera.
   */
  private buildSky(): void {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: SUN_DIR },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGlowColor: { value: new THREE.Color() },
        uGlowStrength: { value: 0.5 },
      },
      vertexShader: `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGlowColor;
        uniform float uGlowStrength;
        varying vec3 vLocal;
        void main() {
          vec3 dir = normalize(vLocal);
          float h = dir.y * 0.5 + 0.5;
          vec3 col = mix(uHorizon, uZenith, smoothstep(0.5, 0.78, h));
          float sunGlow = pow(max(dot(dir, uSunDir), 0.0), 10.0);
          col += uGlowColor * sunGlow * uGlowStrength;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), this.skyMat);
    this.sky = sky;
    this.scene.add(sky);
  }

  /**
   * Rolling terrain: the ground plane displaced by the shared hill function,
   * tinted drier toward the hilltops and sandy toward the shoreline, over a
   * real tiling grass texture.
   */
  private buildGround(): void {
    const groundGeo = new THREE.PlaneGeometry(ARENA.size, ARENA.size, 150, 150);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(0x76b356);
    const high = new THREE.Color(0xc3bd66);
    const rock = new THREE.Color(0x8d8a80);
    const marsh = new THREE.Color(0x5e7f4e);
    const mud = new THREE.Color(0x9a835c);
    const sand = new THREE.Color(0xe0c684);
    const dry = new THREE.Color(0xb3a95e);
    const lush = new THREE.Color(0x4b9a4e);
    const tmp = new THREE.Color();
    const half = ARENA.size / 2;
    const coastBase = ARENA.coastR ?? half;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = groundHeight(ARENA, x, z);
      pos.setY(i, h);
      tmp.copy(low).lerp(high, Math.min(1, h / 6));
      // Meadow patchiness: broad dry/lush blotches plus fine brightness
      // jitter, so the plain never reads as one repeating green.
      const patch = valueNoise(x * 0.016, z * 0.016) * 0.65 + valueNoise(x * 0.055, z * 0.055) * 0.35;
      if (patch > 0.58) tmp.lerp(dry, Math.min(1, (patch - 0.58) * 2.2));
      else if (patch < 0.42) tmp.lerp(lush, Math.min(1, (0.42 - patch) * 2.2));
      tmp.multiplyScalar(0.93 + valueNoise(x * 0.14 + 41, z * 0.14 - 17) * 0.14);
      // High massifs go stony; lowland basins go marshy; pits go bare rock.
      if (h > 7) tmp.lerp(rock, Math.min(1, (h - 7) / 5));
      if (h < -0.3) tmp.lerp(marsh, Math.min(1, -(h + 0.3) / 1.5));
      if (h < -2.5) tmp.lerp(rock, Math.min(1, -(h + 2.5) / 3));
      // Muddy shores around the lakes.
      for (const lake of ARENA.lakes) {
        const d = Math.hypot(x - lake.x, z - lake.z);
        if (d < lake.r + 7) tmp.lerp(mud, 0.6 * Math.min(1, (lake.r + 7 - d) / 9));
      }
      // Beach where the land meets the sea; the drowned skirt is all sand.
      const over = Math.hypot(x, z) - coastRadius(coastBase, Math.atan2(x, z));
      if (over > -12) tmp.lerp(sand, Math.min(1, (over + 12) / 10));
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();

    const grassTex = this.assets.grassTexture;
    grassTex.repeat.set(56, 56);
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: grassTex });
    // Anti-tiling: blend the grass texture with itself at an irrational-ish
    // second scale, so the 56×56 repeat never lines up into a visible grid.
    groundMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = mix(
            texture2D( map, vMapUv ),
            texture2D( map, vMapUv * 0.372 + vec2( 0.13, 0.71 ) ),
            0.5
          );
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      );
    };
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /** The sea: normal-mapped waves with a sun glint, fading into the fog. */
  private buildWater(): THREE.ShaderMaterial {
    // Opaque on purpose: this plane fills half the screen at the horizon, and
    // blending it would be the single biggest fill cost in the frame.
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uNormals: { value: this.assets.waterNormals },
        uSunDir: { value: SUN_DIR },
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
        uDeep: { value: new THREE.Color(0x0a1c33) },
        uSkyTint: { value: new THREE.Color(0x5c5c7a) },
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vView;
        varying float vDist;
        void main() {
          vec3 p = position;
          p.y += sin(p.x * 0.06 + uTime * 0.8) * 0.25 + cos(p.z * 0.05 + uTime * 0.6) * 0.25;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vWorld = world.xyz;
          vView = cameraPosition - world.xyz;
          vec4 mv = viewMatrix * world;
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uNormals;
        uniform vec3 uSunDir;
        uniform vec3 uFogColor;
        uniform vec3 uDeep;
        uniform vec3 uSkyTint;
        varying vec3 vWorld;
        varying vec3 vView;
        varying float vDist;
        void main() {
          vec3 n1 = texture2D(uNormals, vWorld.xz * 0.020 + vec2(uTime * 0.020, uTime * 0.014)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormals, vWorld.xz * 0.047 - vec2(uTime * 0.016, uTime * 0.022)).xyz * 2.0 - 1.0;
          vec3 n = normalize(vec3(n1.x + n2.x, 3.0, n1.y + n2.y));
          vec3 viewDir = normalize(vView);
          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
          vec3 col = mix(uDeep, uSkyTint, fresnel * 0.8);
          float spec = pow(max(dot(n, normalize(viewDir + uSunDir)), 0.0), 70.0);
          col += vec3(1.0, 0.82, 0.55) * spec * 0.9;
          col = mix(col, uFogColor, smoothstep(280.0, 920.0, vDist));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(3800, 3800, 32, 32), mat);
    water.geometry.rotateX(-Math.PI / 2);
    water.position.y = -0.55;
    this.scene.add(water);
    return mat;
  }

  /** Water discs sitting in the lowland bowls, sharing the sea's shader. */
  private buildLakes(): void {
    for (const lake of ARENA.lakes) {
      const bottom = groundHeight(ARENA, lake.x, lake.z);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(lake.r * 1.15, 28), this.waterMat);
      disc.geometry.rotateX(-Math.PI / 2);
      disc.position.set(lake.x, bottom * 0.45, lake.z);
      this.scene.add(disc);
    }
  }

  /** Stage a model clone on the terrain; mergeStatics() bakes the stage down. */
  private place(model: THREE.Group, x: number, z: number, rotY = 0): void {
    model.position.set(x, groundHeight(ARENA, x, z), z);
    model.rotation.y = rotY;
    this.staticStage.add(model);
  }

  /**
   * Static batching, chunked: scenery merges into one mesh per material per
   * ~95m grid cell. Merging kills draw-call count; chunking keeps frustum
   * culling alive — without it every merged mesh spans the whole island, so
   * looking at your feet still drew every tree, and the shadow pass
   * re-rendered all island geometry into the 2048² map every frame.
   */
  private mergeStatics(): void {
    this.staticStage.updateMatrixWorld(true);
    const cell = ARENA.size / 8;
    const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
    const wp = new THREE.Vector3();
    this.staticStage.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const material = o.material as THREE.Material & { map?: THREE.Texture | null };
      const geo = (o.geometry as THREE.BufferGeometry).clone();
      geo.applyMatrix4(o.matrixWorld);
      // Attribute sets must match to merge: uv only matters on textured materials.
      if (!material.map) {
        geo.deleteAttribute('uv');
        geo.deleteAttribute('uv1');
      }
      o.getWorldPosition(wp);
      const cellKey = `${Math.floor(wp.x / cell)}|${Math.floor(wp.z / cell)}`;
      const key = `${material.name}|${material.map ? 'tex' : 'flat'}|${cellKey}`;
      let group = groups.get(key);
      if (!group) {
        group = { material, geos: [] };
        groups.set(key, group);
      }
      group.geos.push(geo);
    });
    for (const { material, geos } of groups.values()) {
      const merged = mergeGeometries(geos, false);
      const batches = merged ? [merged] : geos; // mismatched attributes: keep unmerged
      if (merged) for (const g of geos) g.dispose();
      for (const geometry of batches) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
    }
    this.staticStage.clear();
  }

  /** Keep the sun's shadow box centered on the action. */
  setFocus(x: number, z: number): void {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x, 0, z).addScaledVector(SUN_DIR, 260);
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
      if (ob.kind !== 'circle') return; // the island has no box obstacles anymore
      const rot = i * 2.39; // deterministic "random" facing
      const look = ob.look ?? (ob.height >= 5 ? 'tree' : 'rock');
      if (look === 'tree') {
        const nearShore =
          Math.hypot(ob.x, ob.z) >
          coastRadius(ARENA.coastR ?? ARENA.size / 2, Math.atan2(ob.x, ob.z)) - 50;
        const name = nearShore ? palmPick[i % 2]! : treePick[i % treePick.length]!;
        // Canopy overshoots the collision cylinder; trunks match its radius.
        const tree = this.assets.modelAtHeight(name, ob.height * 1.45);
        tree.scale.x *= 1.2;
        tree.scale.z *= 1.2;
        this.place(tree, ob.x, ob.z, rot);
      } else {
        this.place(this.assets.modelAtHeight(rockPick[i % 3]!, ob.height * 1.1), ob.x, ob.z, rot);
      }
    });
  }

  /** Set dressing that makes each milestone area readable from a distance. */
  private buildLandmarks(): void {
    for (const lm of ARENA.landmarks) {
      switch (lm.kind) {
        case 'wreck': {
          // The beached hulk sits over its collision rock, listing toward the sea.
          const hulk = this.assets.modelAtHeight('ship-wreck', 12);
          this.place(hulk, lm.x, lm.z, -0.5);
          this.place(this.assets.modelAtHeight('flag-pirate-high', 6), lm.x - 10, lm.z + 12, 2.4);
          this.place(this.assets.modelAtHeight('campfire_logs', 0.8), lm.x - 12, lm.z - 5, 0);
          this.place(this.assets.modelAtHeight('boat-row-small', 1.4), lm.x + 12, lm.z - 12, 1.1);
          break;
        }
        case 'spire': {
          // A watchtower on the island's highest point — visible from anywhere.
          this.place(this.assets.modelAtHeight('tower-watch', 13), lm.x, lm.z, 0.6);
          this.place(this.assets.modelAtHeight('flag-pirate-high', 6), lm.x + 7, lm.z + 2, -0.4);
          break;
        }
        case 'stonering': {
          this.place(this.assets.modelAtHeight('campfire_logs', 0.9), lm.x, lm.z + 2.5, 0);
          break;
        }
        case 'grove': {
          this.place(this.assets.modelAtHeight('log_stack', 1.1), lm.x + 7, lm.z + 6, 0.9);
          this.place(this.assets.modelAtHeight('stump_old', 0.8), lm.x - 8, lm.z + 3, 0);
          break;
        }
        case 'pit': {
          // Old digging gear abandoned at the lip.
          this.place(this.assets.modelAtHeight('log_stack', 1.0), lm.x + lm.r + 3, lm.z + 4, 0.4);
          this.place(this.assets.modelAtHeight('campfire_logs', 0.8), lm.x - lm.r - 4, lm.z - 2, 0);
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
      const boat = this.assets.modelAtHeight('boat-row-small', 1.4);
      this.place(boat, Math.sin(angle) * r, Math.cos(angle) * r, rot);
    }
  }

  /** Puffy low-poly clouds drifting high over the island. */
  private buildClouds(): void {
    const rng = new Rng(0xc10d);
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: 0xd9dce8,
      roughness: 1,
      transparent: true,
      opacity: 0.82,
      flatShading: true,
    });
    const cloudMat = this.cloudMat;
    for (let c = 0; c < 14; c++) {
      const group = new THREE.Group();
      const puffs = 3 + (c % 3);
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), cloudMat);
        puff.position.set(rng.range(-14, 14), rng.range(-2, 2), rng.range(-6, 6));
        puff.scale.set(rng.range(7, 13), rng.range(3, 4.5), rng.range(5, 8));
        puff.rotation.y = rng.range(0, Math.PI);
        group.add(puff);
      }
      group.position.set(rng.range(-700, 700), rng.range(95, 150), rng.range(-700, 700));
      this.clouds.push({ group, speed: rng.range(1.5, 4) });
      this.scene.add(group);
    }
  }

  /** Retint sky, fog, lights, water, and clouds to a time-of-day preset. */
  setEnvironment(id: EnvironmentId): void {
    const env = ENVIRONMENTS[id] ?? ENVIRONMENTS.day;
    (this.scene.fog as THREE.Fog).color.setHex(env.fog);
    (this.scene.background as THREE.Color).setHex(env.fog);
    (this.skyMat.uniforms.uZenith!.value as THREE.Color).setHex(env.zenith);
    (this.skyMat.uniforms.uHorizon!.value as THREE.Color).setHex(env.horizon);
    (this.skyMat.uniforms.uGlowColor!.value as THREE.Color).setHex(env.glow);
    this.skyMat.uniforms.uGlowStrength!.value = env.glowStrength;
    this.hemi.color.setHex(env.hemiSky);
    this.hemi.groundColor.setHex(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity;
    this.sun.color.setHex(env.sun);
    this.sun.intensity = env.sunIntensity;
    (this.waterMat.uniforms.uFogColor!.value as THREE.Color).setHex(env.fog);
    (this.waterMat.uniforms.uDeep!.value as THREE.Color).setHex(env.waterDeep);
    (this.waterMat.uniforms.uSkyTint!.value as THREE.Color).setHex(env.waterSky);
    this.renderer.toneMappingExposure = env.exposure;
    this.cloudMat.color.setHex(env.cloud);
    this.cloudMat.opacity = env.cloudOpacity;
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
  }

  render(): void {
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    this.sky.position.copy(this.camera.position);
    this.stormWallMat.uniforms.uTime!.value = t;
    this.waterMat.uniforms.uTime!.value = t;
    for (const cloud of this.clouds) {
      cloud.group.position.x += cloud.speed * dt;
      if (cloud.group.position.x > 800) cloud.group.position.x = -800;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
