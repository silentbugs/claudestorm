import * as THREE from 'three';
import { ARENA, STORM_START_RADIUS } from '@claudestorm/shared';

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
      700,
    );

    this.scene.background = new THREE.Color(0x121627);
    this.scene.fog = new THREE.Fog(0x121627, 150, 420);

    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -110;
    sun.shadow.camera.right = 110;
    sun.shadow.camera.top = 110;
    sun.shadow.camera.bottom = -110;
    sun.shadow.camera.far = 300;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA.size, ARENA.size),
      new THREE.MeshStandardMaterial({ color: 0x35543a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(ARENA.size, 50, 0x466a4e, 0x3d5c44);
    grid.position.y = 0.02;
    this.scene.add(grid);

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
      group.position.set(ob.x, 0, ob.z);
      group.traverse((m) => {
        m.castShadow = true;
        m.receiveShadow = true;
      });
      this.scene.add(group);
    });

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
    this.setStormRadius(STORM_START_RADIUS);
    this.scene.add(this.stormWall);

    window.addEventListener('resize', () => this.resize());
  }

  setStormRadius(radius: number): void {
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
