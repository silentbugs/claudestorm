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
      600,
    );

    this.scene.background = new THREE.Color(0x121627);
    this.scene.fog = new THREE.Fog(0x121627, 130, 340);

    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.camera.far = 260;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA.size, ARENA.size),
      new THREE.MeshStandardMaterial({ color: 0x35543a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(ARENA.size, 40, 0x466a4e, 0x3d5c44);
    grid.position.y = 0.02;
    this.scene.add(grid);

    const obstacleMat = new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 0.9 });
    for (const ob of ARENA.obstacles) {
      const mesh =
        ob.kind === 'box'
          ? new THREE.Mesh(new THREE.BoxGeometry(ob.hx * 2, ob.height, ob.hz * 2), obstacleMat)
          : new THREE.Mesh(new THREE.CylinderGeometry(ob.r, ob.r, ob.height, 20), obstacleMat);
      mesh.position.set(ob.x, ob.height / 2, ob.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

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
