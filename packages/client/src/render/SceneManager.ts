import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA, Rng, STORM_START_RADIUS, terrainHeight } from '@claudestorm/shared';
import type { AssetLibrary, ModelName } from './assets.js';

const FOG_COLOR = 0x453e58;
const SUN_DIR = new THREE.Vector3(0.55, 0.5, 0.32).normalize();

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
  /** Staging area for static scenery; merged into per-material meshes at the end. */
  private readonly staticStage = new THREE.Group();

  constructor(container: HTMLElement, private readonly assets: AssetLibrary) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
      900,
    );

    this.scene.fog = new THREE.Fog(FOG_COLOR, 240, 760);
    this.buildSky();

    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.85);
    this.scene.add(hemi);
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
    this.buildObstacles();
    this.scatterFoliage();
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
          float alpha = (0.08 + glow * 0.24) * (0.3 + vert * 0.7);
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

    window.addEventListener('resize', () => this.resize());
  }

  /** Gradient sky dome with a warm glow around the sun's side of the horizon. */
  private buildSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(840, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uSunDir: { value: SUN_DIR } },
        vertexShader: `
          varying vec3 vWorld;
          void main() {
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 uSunDir;
          varying vec3 vWorld;
          void main() {
            vec3 dir = normalize(vWorld);
            float h = dir.y * 0.5 + 0.5;
            vec3 zenith = vec3(0.10, 0.14, 0.28);
            vec3 horizon = vec3(0.55, 0.42, 0.52);
            vec3 col = mix(horizon, zenith, smoothstep(0.5, 0.78, h));
            float sunGlow = pow(max(dot(dir, uSunDir), 0.0), 10.0);
            col += vec3(1.0, 0.72, 0.38) * sunGlow * 0.5;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
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
    const low = new THREE.Color(0x86b06e);
    const high = new THREE.Color(0xc0bd7e);
    const sand = new THREE.Color(0xd8c491);
    const tmp = new THREE.Color();
    const half = ARENA.size / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(ARENA.hills, x, z);
      pos.setY(i, h);
      tmp.copy(low).lerp(high, Math.min(1, h / 6));
      // Beach ring toward the water's edge.
      const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
      if (edge > 0.9) tmp.lerp(sand, Math.min(1, (edge - 0.9) / 0.08));
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();

    const grassTex = this.assets.grassTexture;
    grassTex.repeat.set(56, 56);
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: grassTex }),
    );
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
        varying vec3 vWorld;
        varying vec3 vView;
        varying float vDist;
        void main() {
          vec3 n1 = texture2D(uNormals, vWorld.xz * 0.020 + vec2(uTime * 0.020, uTime * 0.014)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormals, vWorld.xz * 0.047 - vec2(uTime * 0.016, uTime * 0.022)).xyz * 2.0 - 1.0;
          vec3 n = normalize(vec3(n1.x + n2.x, 3.0, n1.y + n2.y));
          vec3 viewDir = normalize(vView);
          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
          vec3 deep = vec3(0.04, 0.11, 0.20);
          vec3 skyTint = vec3(0.36, 0.36, 0.48);
          vec3 col = mix(deep, skyTint, fresnel * 0.8);
          float spec = pow(max(dot(n, normalize(viewDir + uSunDir)), 0.0), 70.0);
          col += vec3(1.0, 0.82, 0.55) * spec * 0.9;
          col = mix(col, uFogColor, smoothstep(240.0, 760.0, vDist));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600, 32, 32), mat);
    water.geometry.rotateX(-Math.PI / 2);
    water.position.y = -0.55;
    this.scene.add(water);
    return mat;
  }

  /** Stage a model clone on the terrain; mergeStatics() bakes the stage down. */
  private place(model: THREE.Group, x: number, z: number, rotY = 0): void {
    model.position.set(x, terrainHeight(ARENA.hills, x, z), z);
    model.rotation.y = rotY;
    this.staticStage.add(model);
  }

  /**
   * Static batching: the ~110 staged scenery models would otherwise be ~250
   * draw calls in the main pass and again in the shadow pass whenever the
   * whole island is in the frustum. Bake them into one mesh per material
   * (Kenney reuses a handful of named materials across the kits).
   */
  private mergeStatics(): void {
    this.staticStage.updateMatrixWorld(true);
    const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
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
      const key = `${material.name}|${material.map ? 'tex' : 'flat'}`;
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
   * the raw shapes): tall cylinders are trees (palms near the shore), short
   * ones rocks; boxes become walls, huts, or crates by footprint.
   */
  private buildObstacles(): void {
    const treePick: ModelName[] = [
      'tree_oak', 'tree_fat', 'tree_pineDefaultA', 'tree_tall', 'tree_thin', 'tree_pineDefaultB',
    ];
    const palmPick: ModelName[] = ['tree_palm', 'tree_palmTall'];
    const rockPick: ModelName[] = ['rock_tallA', 'rock_tallB', 'rock_tallC'];

    ARENA.obstacles.forEach((ob, i) => {
      const rot = i * 2.39; // deterministic "random" facing
      if (ob.kind === 'circle') {
        if (ob.height >= 5) {
          const nearShore = Math.max(Math.abs(ob.x), Math.abs(ob.z)) > 168;
          const name = nearShore ? palmPick[i % 2]! : treePick[i % treePick.length]!;
          // Canopy overshoots the collision cylinder; trunks match its radius.
          this.place(this.assets.modelAtHeight(name, ob.height * 1.45), ob.x, ob.z, rot);
        } else {
          this.place(this.assets.modelAtHeight(rockPick[i % 3]!, ob.height * 1.1), ob.x, ob.z, rot);
        }
        return;
      }
      // Boxes: long thin footprints are ruin walls, large ones huts, small ones crates.
      const long = Math.max(ob.hx, ob.hz);
      const thin = Math.min(ob.hx, ob.hz);
      const name: ModelName =
        long >= 3.5 && thin <= 1.6 ? 'castle-wall' : long >= 2.2 && ob.height >= 3 ? 'structure' : 'crate';
      const model = this.assets.model(name);
      const size = this.assets.size(name);
      model.scale.set(
        (ob.hx * 2) / Math.max(0.001, size.x),
        (ob.height * (name === 'structure' ? 1.2 : 1.05)) / Math.max(0.001, size.y),
        (ob.hz * 2) / Math.max(0.001, size.z),
      );
      this.place(model, ob.x, ob.z);
    });
  }

  /** Instanced foliage stamped from the nature-kit models. */
  private scatterFoliage(): void {
    const rng = new Rng(1337);
    const half = ARENA.size / 2 - 8;
    const blocked = (x: number, z: number): boolean => {
      for (const ob of ARENA.obstacles) {
        const clearance = ob.kind === 'box' ? Math.max(ob.hx, ob.hz) + 1.5 : ob.r + 1.5;
        if (Math.hypot(x - ob.x, z - ob.z) < clearance) return true;
      }
      return false;
    };
    const placements = (count: number): { x: number; z: number; s: number; rot: number }[] => {
      const out: { x: number; z: number; s: number; rot: number }[] = [];
      let guard = 0;
      while (out.length < count && guard++ < count * 4) {
        const x = rng.range(-half, half);
        const z = rng.range(-half, half);
        if (blocked(x, z)) continue;
        out.push({ x, z, s: rng.range(0.7, 1.4), rot: rng.range(0, Math.PI * 2) });
      }
      return out;
    };

    const dummy = new THREE.Object3D();
    const stamp = (name: ModelName, count: number, targetHeight: number, shadows: boolean): void => {
      const spots = placements(count);
      const base = targetHeight / Math.max(0.001, this.assets.size(name).y);
      for (const part of this.assets.meshParts(name)) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
        spots.forEach((p, idx) => {
          dummy.position.set(p.x, terrainHeight(ARENA.hills, p.x, p.z), p.z);
          dummy.rotation.set(0, p.rot, 0);
          dummy.scale.setScalar(p.s * base);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx, dummy.matrix);
        });
        mesh.castShadow = shadows;
        this.scene.add(mesh);
      }
    };

    stamp('grass', 420, 0.5, false);
    stamp('grass_large', 240, 0.55, false);
    stamp('plant_bush', 150, 0.8, true);
    stamp('plant_bushLarge', 70, 1.1, true);
    stamp('rock_largeA', 60, 0.7, true);
    stamp('flower_redA', 50, 0.5, false);
    stamp('flower_purpleA', 50, 0.5, false);
    stamp('flower_yellowA', 50, 0.5, false);
    stamp('mushroom_red', 30, 0.35, false);
    stamp('mushroom_tanGroup', 25, 0.3, false);
    stamp('stump_round', 25, 0.5, true);
    stamp('log', 20, 0.55, true);
  }

  /** Wrecks and rowboats beached on the sand ring. */
  private buildShoreline(): void {
    const wreck = this.assets.modelAtHeight('ship-wreck', 11);
    this.place(wreck, 192, -55, 2.3);
    const boatA = this.assets.modelAtHeight('boat-row-small', 1.4);
    this.place(boatA, -190, 118, 0.8);
    const boatB = this.assets.modelAtHeight('boat-row-small', 1.4);
    this.place(boatB, 64, 196, -1.9);
    const camp = this.assets.modelAtHeight('campfire_logs', 0.8);
    this.place(camp, 186, -42, 0);
    const flag = this.assets.modelAtHeight('flag-pirate-high', 6);
    this.place(flag, 196, -62, 2.6);
  }

  /** Puffy low-poly clouds drifting high over the island. */
  private buildClouds(): void {
    const rng = new Rng(0xc10d);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xd9dce8,
      roughness: 1,
      transparent: true,
      opacity: 0.82,
      flatShading: true,
    });
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
    this.stormWallMat.uniforms.uTime!.value = t;
    this.waterMat.uniforms.uTime!.value = t;
    for (const cloud of this.clouds) {
      cloud.group.position.x += cloud.speed * dt;
      if (cloud.group.position.x > 800) cloud.group.position.x = -800;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
