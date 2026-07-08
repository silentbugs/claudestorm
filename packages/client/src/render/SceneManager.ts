import * as THREE from 'three';
import { ARENA, Rng, STORM_START_RADIUS, terrainHeight } from '@claudestorm/shared';

/** Owns the Three.js scene, camera, lights, arena geometry, and storm wall. */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly stormWall: THREE.Mesh;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      900,
    );

    this.scene.background = new THREE.Color(0x121627);
    this.scene.fog = new THREE.Fog(0x121627, 180, 520);

    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -160;
    sun.shadow.camera.right = 160;
    sun.shadow.camera.top = 160;
    sun.shadow.camera.bottom = -160;
    sun.shadow.camera.far = 380;
    this.scene.add(sun);

    // Rolling terrain: the ground plane displaced by the shared hill function,
    // tinted drier toward the hilltops.
    const groundGeo = new THREE.PlaneGeometry(ARENA.size, ARENA.size, 150, 150);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(0x35543a);
    const high = new THREE.Color(0x74804c);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = terrainHeight(ARENA.hills, pos.getX(i), pos.getZ(i));
      pos.setY(i, h);
      tmp.copy(low).lerp(high, Math.min(1, h / 6));
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Obstacle dressing (visual only — the sim collides with the raw shapes):
    // tall cylinders read as trees, short ones as rock pillars, boxes as huts.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 });
    const wallMatAlt = new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8f4b32, roughness: 0.85 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.9 });
    const leafMatAlt = new THREE.MeshStandardMaterial({ color: 0x4c8a40, roughness: 0.9 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 0.95 });

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
          const door = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 1.5, 0.12),
            new THREE.MeshStandardMaterial({ color: 0x4a331f, roughness: 0.9 }),
          );
          door.position.set(0, 0.75, ob.hz + 0.02);
          group.add(door);
        }
      } else if (ob.height >= 5) {
        // Tree: trunk matches the collision radius, canopy flares above head height.
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(ob.r * 0.85, ob.r, ob.height, 12),
          trunkMat,
        );
        trunk.position.y = ob.height / 2;
        group.add(trunk);
        const leaves = i % 2 === 0 ? leafMat : leafMatAlt;
        const lower = new THREE.Mesh(new THREE.ConeGeometry(ob.r * 2.4, ob.r * 3.6, 10), leaves);
        lower.position.y = ob.height * 0.75;
        const upper = new THREE.Mesh(new THREE.ConeGeometry(ob.r * 1.7, ob.r * 3, 10), leaves);
        upper.position.y = ob.height * 0.75 + ob.r * 2;
        group.add(lower, upper);
      } else {
        // Squat cylinder: weathered rock pillar.
        const rock = new THREE.Mesh(
          new THREE.CylinderGeometry(ob.r * 0.8, ob.r, ob.height, 7),
          rockMat,
        );
        rock.position.y = ob.height / 2;
        rock.rotation.y = i * 1.7;
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

    this.scatterFoliage();

    this.stormWall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 40, 96, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9b4dff,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.stormWall.position.y = 20;
    this.setStorm(0, 0, STORM_START_RADIUS);
    this.scene.add(this.stormWall);

    window.addEventListener('resize', () => this.resize());
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

    const grass = placements(320);
    fill(
      new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.14, 0.55, 5),
        new THREE.MeshStandardMaterial({ color: 0x55803f, roughness: 1 }),
        grass.length,
      ),
      grass,
      0.25,
    );
    const bushes = placements(110);
    fill(
      new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.65, 0),
        new THREE.MeshStandardMaterial({ color: 0x2f5c33, roughness: 1 }),
        bushes.length,
      ),
      bushes,
      0.4,
    );
    const rocks = placements(45);
    fill(
      new THREE.InstancedMesh(
        new THREE.DodecahedronGeometry(0.45, 0),
        new THREE.MeshStandardMaterial({ color: 0x8a877e, roughness: 0.95 }),
        rocks.length,
      ),
      rocks,
      0.2,
    );
    const flowers = placements(70);
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
    this.renderer.render(this.scene, this.camera);
  }
}
