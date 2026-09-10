import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * HDR pipeline: the scene renders into a multisampled half-float target
 * (MSAA stays on, unlike the classic composer setup), a half-resolution
 * bloom lifts everything brighter than white — spell cores, visors, the
 * sun, storm lightning — into a soft halo, and the output pass applies
 * ACES tone mapping and the sRGB transfer at the very end, once, on the
 * final image. Tone mapping happens here rather than per-material, so the
 * bloom sees true linear HDR values.
 */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly target: THREE.WebGLRenderTarget;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: { samples: number; bloomStrength: number },
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const hdr = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: opts.samples,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.addPass(new RenderPass(scene, camera));
    // The pass halves the resolution itself, then blurs down 5 mip levels.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), opts.bloomStrength, 0.55, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.bloom.dispose();
    this.composer.dispose();
    this.target.dispose();
  }
}
