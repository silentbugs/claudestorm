import * as THREE from 'three';
import { ARENA, Rng, STORM_START_RADIUS, terrainHeight } from '@claudestorm/shared';

const FOG_COLOR = 0x453e58;

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

  constructor(container: HTMLElement) {
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
    const sun = new THREE.DirectionalLight(0xffe6c0, 1.7);
    sun.position.set(120, 170, 70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -230;
    sun.shadow.camera.right = 230;
    sun.shadow.camera.top = 230;
    sun.shadow.camera.bottom = -230;
    sun.shadow.camera.far = 620;
    this.scene.add(sun);

    this.buildGround();
    this.waterMat = this.buildWater();
    this.buildObstacles();
    this.scatterFoliage();
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
        uniforms: { uSunDir: { value: new THREE.Vector3(0.55, 0.5, 0.32).normalize() } },
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
   * tinted drier toward the hilltops and sandy toward the shoreline, with a
   * procedural noise texture for close-up detail.
   */
  private buildGround(): void {
    const groundGeo = new THREE.PlaneGeometry(ARENA.size, ARENA.size, 150, 150);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(0x35543a);
    const high = new THREE.Color(0x74804c);
    const sand = new THREE.Color(0xb3a374);
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

    // Subtle brightness noise so the ground isn't a flat wash up close.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const noiseRng = new Rng(7);
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 216 + Math.floor(noiseRng.next() * 40);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const detail = new THREE.CanvasTexture(canvas);
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    detail.repeat.set(60, 60);

    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: detail }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /** The sea around the island: a huge plane with gently rolling shader waves. */
  private buildWater(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vPos;
        varying float vDist;
        void main() {
          vec3 p = position;
          p.y += sin(p.x * 0.06 + uTime * 0.8) * 0.3 + cos(p.z * 0.05 + uTime * 0.6) * 0.3;
          vPos = p;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uFogColor;
        varying vec3 vPos;
        varying float vDist;
        void main() {
          float sparkle = sin(vPos.x * 0.35 + uTime * 1.3) * sin(vPos.z * 0.3 - uTime * 1.1);
          vec3 deep = vec3(0.05, 0.12, 0.22);
          vec3 crest = vec3(0.17, 0.32, 0.44);
          vec3 col = mix(deep, crest, smoothstep(-0.6, 1.0, sparkle));
          col = mix(col, uFogColor, smoothstep(240.0, 760.0, vDist));
          gl_FragColor = vec4(col, 0.96);
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600, 64, 64), mat);
    water.geometry.rotateX(-Math.PI / 2);
    water.position.y = -0.55;
    this.scene.add(water);
    return mat;
  }

  /**
   * Obstacle dressing (visual only — the sim collides with the raw shapes):
   * tall cylinders read as trees, short ones as rock pillars, boxes as huts.
   */
  private buildObstacles(): void {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 });
    const wallMatAlt = new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8f4b32, roughness: 0.85 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.9 });
    const leafMatAlt = new THREE.MeshStandardMaterial({ color: 0x4c8a40, roughness: 0.9 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 0.95 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a331f, roughness: 0.9 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x2b2b33,
      emissive: 0xffbf5e,
      emissiveIntensity: 0.7,
    });

    ARENA.obstacles.forEach((ob, i) => {
      const group = new THREE.Group();
      if (ob.kind === 'box') {
        const walls = new THREE.Mesh(
          new THREE.BoxGeometry(ob.hx * 2, ob.height, ob.hz * 2),
          i % 2 === 0 ? wallMat : wallMatAlt,
        );
        walls.position.y = ob.height / 2;
        group.add(walls);
        if (ob.height >= 3) {
          const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.hypot(ob.hx, ob.hz) * 1.15, 1.4, 4),
            roofMat,
          );
          roof.rotation.y = Math.PI / 4;
          roof.position.y = ob.height + 0.7;
          group.add(roof);
          const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.12), doorMat);
          door.position.set(0, 0.75, ob.hz + 0.02);
          group.add(door);
          // Lit windows so camps feel inhabited at dusk.
          if (ob.hx >= 1.6) {
            for (const side of [-1, 1]) {
              const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.08), windowMat);
              win.position.set(side * ob.hx * 0.55, 1.7, ob.hz + 0.02);
              group.add(win);
            }
          }
        }
      } else if (ob.height >= 5) {
        // Tree: trunk matches the collision radius; canopy alternates between
        // pine cones and broadleaf blobs so groves read as mixed forest.
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(ob.r * 0.85, ob.r, ob.height, 12),
          trunkMat,
        );
        trunk.position.y = ob.height / 2;
        group.add(trunk);
        const leaves = i % 2 === 0 ? leafMat : leafMatAlt;
        if (i % 3 === 0) {
          const lower = new THREE.Mesh(new THREE.ConeGeometry(ob.r * 2.4, ob.r * 3.6, 10), leaves);
          lower.position.y = ob.height * 0.75;
          const upper = new THREE.Mesh(new THREE.ConeGeometry(ob.r * 1.7, ob.r * 3, 10), leaves);
          upper.position.y = ob.height * 0.75 + ob.r * 2;
          group.add(lower, upper);
        } else {
          const blobGeo = new THREE.IcosahedronGeometry(1, 0);
          const offsets: [number, number, number, number][] = [
            [0, ob.height * 0.92, 0, ob.r * 2.1],
            [ob.r * 1.3, ob.height * 0.78, ob.r * 0.7, ob.r * 1.5],
            [-ob.r * 1.2, ob.height * 0.8, -ob.r * 0.6, ob.r * 1.4],
          ];
          for (const [bx, by, bz, s] of offsets) {
            const blob = new THREE.Mesh(blobGeo, leaves);
            blob.position.set(bx, by, bz);
            blob.scale.setScalar(s);
            blob.rotation.y = i + bx;
            group.add(blob);
          }
        }
      } else {
        // Squat cylinder: weathered rock pillar.
        const rock = new THREE.Mesh(
          new THREE.CylinderGeometry(ob.r * 0.8, ob.r, ob.height, 7),
          rockMat,
        );
        rock.position.y = ob.height / 2;
        rock.rotation.y = i * 1.7;
        rock.rotation.z = ((i % 5) - 2) * 0.03;
        group.add(rock);
        const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(ob.r * 0.75, 0), rockMat);
        cap.position.y = ob.height;
        group.add(cap);
      }
      group.position.set(ob.x, terrainHeight(ARENA.hills, ob.x, ob.z), ob.z);
      group.traverse((m) => {
        m.castShadow = true;
        m.receiveShadow = true;
      });
      this.scene.add(group);
    });
  }

  /** Deterministic decorative scatter: grass, bushes, rocks, flowers on the terrain. */
  private scatterFoliage(): void {
    const rng = new Rng(1337);
    const half = ARENA.size / 2 - 5;
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
        out.push({ x, z, s: rng.range(0.6, 1.5), rot: rng.range(0, Math.PI * 2) });
      }
      return out;
    };
    const dummy = new THREE.Object3D();
    const fill = (
      mesh: THREE.InstancedMesh,
      spots: { x: number; z: number; s: number; rot: number }[],
      yOffset: number,
      colors?: number[],
    ): void => {
      const tint = new THREE.Color();
      spots.forEach((p, i) => {
        dummy.position.set(p.x, terrainHeight(ARENA.hills, p.x, p.z) + yOffset * p.s, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(p.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (colors) mesh.setColorAt(i, tint.setHex(colors[i % colors.length]!));
      });
      mesh.count = spots.length;
      mesh.castShadow = true;
      this.scene.add(mesh);
    };

    const grass = placements(650);
    fill(
      new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.14, 0.55, 5),
        new THREE.MeshStandardMaterial({ color: 0x55803f, roughness: 1 }),
        grass.length,
      ),
      grass,
      0.25,
    );
    const bushes = placements(220);
    fill(
      new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.65, 0),
        new THREE.MeshStandardMaterial({ color: 0x2f5c33, roughness: 1 }),
        bushes.length,
      ),
      bushes,
      0.4,
    );
    const rocks = placements(90);
    fill(
      new THREE.InstancedMesh(
        new THREE.DodecahedronGeometry(0.45, 0),
        new THREE.MeshStandardMaterial({ color: 0x8a877e, roughness: 0.95 }),
        rocks.length,
      ),
      rocks,
      0.2,
    );
    const flowers = placements(140);
    fill(
      new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.1, 6, 5),
        new THREE.MeshStandardMaterial({ roughness: 0.7 }),
        flowers.length,
      ),
      flowers,
      0.3,
      [0xe86fa4, 0xf3d34d, 0xf0f0e8, 0x9a6fe8],
    );
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
