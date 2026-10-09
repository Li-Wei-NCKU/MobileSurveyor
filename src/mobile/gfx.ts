/**
 * 手機效能預算。
 * gfxPre.ts 在場景建立前就把 window.__mobileGfx 設好 (像素比、陰影、草叢數)；
 * applyGfx 在場景建好後再調霧、遠裁面，並做動態解析度 (連續掉幀就降到 1.0)。
 */
import * as THREE from 'three';
import type { AnyObj } from '../field/legacy';

export interface Gfx { dpr: number; shadow: boolean; shadowRes: number; shadowD: number; grass: number; antialias: boolean; low: boolean }

export function detectGfx(): Gfx {
  const nav = navigator as AnyObj;
  const mem: number = nav.deviceMemory || 4;
  const cores = nav.hardwareConcurrency || 4;
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
  let low = mem <= 3 || cores <= 4;
  // 透過 WebGL 看 GPU 型號 (抓不到就算了)
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const r: string = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Mali-4|Mali-T|Adreno \(TM\) [45]|PowerVR/i.test(r)) low = true;
  } catch { /* 無法偵測 */ }
  const dpr = Math.min(window.devicePixelRatio || 1, low ? 1.0 : 1.5);
  return {
    dpr,
    shadow: !low,
    shadowRes: low ? 512 : 1024,
    shadowD: 24,
    grass: low ? 2500 : mobile ? 6000 : 12000,
    antialias: dpr <= 1,
    low,
  };
}

export function applyGfx(sm: AnyObj) {
  const g: Gfx = (window as AnyObj).__mobileGfx;
  const r = sm.renderer as THREE.WebGLRenderer;
  const cam = sm.camera as THREE.PerspectiveCamera;
  cam.far = 420; cam.updateProjectionMatrix();
  if (sm.scene.fog) { sm.scene.fog.near = 60; sm.scene.fog.far = 260; }
  if (!g.shadow && sm.hemiLight) sm.hemiLight.intensity = 1.35;
  // 動態解析度：連續 30 幀 > 24 ms 就降到 1.0
  let slow = 0, last = performance.now();
  const orig = sm.render.bind(sm);
  sm.render = () => {
    const now = performance.now();
    const dt = now - last; last = now;
    if (dt > 24 && dt < 500) { if (++slow > 30 && r.getPixelRatio() > 1) { r.setPixelRatio(1); slow = -9999; } } else slow = Math.max(0, slow - 1);
    orig();
  };
}
