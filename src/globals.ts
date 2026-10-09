/**
 * 舊版 (legacy) 程式以全域 THREE 撰寫。這裡建立一個相容墊片：
 * - 將 three 模組掛到 window.THREE
 * - CanvasTexture 預設 sRGB 色彩空間 (新版 three 的色彩管理需要)
 * 新程式請直接 `import * as THREE from 'three'`。
 */
import * as THREE_NS from 'three';

class SRGBCanvasTexture extends THREE_NS.CanvasTexture {
  constructor(canvas?: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas as HTMLCanvasElement);
    this.colorSpace = THREE_NS.SRGBColorSpace;
  }
}

const shim: Record<string, unknown> = { ...THREE_NS, CanvasTexture: SRGBCanvasTexture };
(window as unknown as { THREE: unknown }).THREE = shim;

export const THREE = THREE_NS;
export { SRGBCanvasTexture };
