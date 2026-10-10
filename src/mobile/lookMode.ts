/**
 * 手機版的「自己瞄」模式：拍點位照片時，鏡頭從 2.5D 追隨切成第一人稱，
 * 用手指拖動轉頭 (左右轉、上下抬)，兩指或右邊的鍵可以變焦 (廣角 ↔ 望遠)。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import type { MobilePlayer } from './player';

let stop: (() => void) | null = null;

const FOV_WIDE = 72, FOV_TELE = 20, FOV_DEF = 62;

export function lookActive() { return !!stop; }

export function startLook(app: GameApp, player: MobilePlayer) {
  if (stop) return;
  const cam = app.sceneManager.camera as THREE.PerspectiveCamera;
  const savedCtl = player.externalControl;
  const savedFov = cam.fov;
  const e = new THREE.Euler(player.euler.x, player.euler.y, 0, 'YXZ');
  let fov = FOV_DEF;
  const pad = document.createElement('div');
  pad.className = 'm-look';
  pad.innerHTML = `
    <span>拖曳畫面取景・兩指縮放</span>
    <div class="m-look-zoom">
      <button type="button" data-z="in">＋</button>
      <b class="m-look-x">1.0×</b>
      <button type="button" data-z="out">−</button>
    </div>`;
  document.body.appendChild(pad);
  const xLabel = pad.querySelector('.m-look-x') as HTMLElement;
  const setFov = (v: number) => {
    fov = THREE.MathUtils.clamp(v, FOV_TELE, FOV_WIDE);
    xLabel.textContent = `${(FOV_DEF / fov).toFixed(1)}×`;
  };
  setFov(FOV_DEF);
  pad.querySelectorAll<HTMLButtonElement>('button[data-z]').forEach(b => {
    const step = () => setFov(fov * (b.dataset.z === 'in' ? 0.82 : 1.22));
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); step(); });
  });

  // 拖曳轉頭 ＋ 兩指縮放
  const pts = new Map<number, { x: number; y: number }>();
  let pinch0 = 0, fov0 = fov;
  const isBtn = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.m-look-zoom');
  pad.addEventListener('pointerdown', (ev) => {
    if (isBtn(ev.target)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      fov0 = fov;
    }
    pad.classList.add('on');
    try { pad.setPointerCapture(ev.pointerId); } catch { /* 合成事件 */ }
  });
  pad.addEventListener('pointermove', (ev) => {
    const prev = pts.get(ev.pointerId);
    if (!prev) return;
    if (pts.size >= 2) {
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      setFov(fov0 * (pinch0 / d));
      return;
    }
    // 視野越窄，手指轉得越慢 (望遠端才好對準)
    const k = 0.0032 * (fov / FOV_DEF);
    e.y -= (ev.clientX - prev.x) * k;
    e.x = THREE.MathUtils.clamp(e.x - (ev.clientY - prev.y) * k, -1.2, 1.1);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  });
  const up = (ev: PointerEvent) => {
    pts.delete(ev.pointerId);
    if (!pts.size) pad.classList.remove('on');
    try { pad.releasePointerCapture(ev.pointerId); } catch { /* 合成事件 */ }
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);

  player.externalControl = () => {
    cam.position.copy(player.position);
    cam.up.set(0, 1, 0);
    cam.quaternion.setFromEuler(e);
    player.euler.copy(e);          // 讓遊戲原本用 player.euler 的判斷照常運作
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * 0.25; cam.updateProjectionMatrix(); }
  };
  stop = () => {
    pad.remove();
    player.externalControl = savedCtl;
    cam.fov = savedFov;
    cam.updateProjectionMatrix();
    stop = null;
  };
}

export function stopLook() { stop?.(); }

export function installLookMode(app: GameApp, player: MobilePlayer) {
  (window as AnyObj).__lookMode = (on: boolean) => { if (on) startLook(app, player); else stopLook(); };
}
