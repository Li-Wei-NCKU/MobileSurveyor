/**
 * 手機版的「自己瞄」模式：拍點位照片時，鏡頭從 2.5D 追隨切成第一人稱，
 * 用手指拖動轉頭 (左右轉、上下抬)，這樣才有辦法取景。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import type { MobilePlayer } from './player';

let stop: (() => void) | null = null;

export function lookActive() { return !!stop; }

export function startLook(app: GameApp, player: MobilePlayer) {
  if (stop) return;
  const cam = app.sceneManager.camera as THREE.PerspectiveCamera;
  const savedCtl = player.externalControl;
  const savedFov = cam.fov;
  const e = new THREE.Euler(player.euler.x, player.euler.y, 0, 'YXZ');
  const pad = document.createElement('div');
  pad.className = 'm-look';
  pad.innerHTML = '<span>拖曳畫面取景</span>';
  document.body.appendChild(pad);
  let on = false, px = 0, py = 0;
  pad.addEventListener('pointerdown', (ev) => {
    on = true; px = ev.clientX; py = ev.clientY;
    pad.classList.add('on');
    try { pad.setPointerCapture(ev.pointerId); } catch { /* 合成事件 */ }
  });
  pad.addEventListener('pointermove', (ev) => {
    if (!on) return;
    e.y -= (ev.clientX - px) * 0.0032;
    e.x = THREE.MathUtils.clamp(e.x - (ev.clientY - py) * 0.0032, -1.2, 1.1);
    px = ev.clientX; py = ev.clientY;
  });
  const up = (ev: PointerEvent) => { on = false; pad.classList.remove('on'); try { pad.releasePointerCapture(ev.pointerId); } catch { /* 合成事件 */ } };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);

  player.externalControl = () => {
    cam.position.copy(player.position);
    cam.up.set(0, 1, 0);
    cam.quaternion.setFromEuler(e);
    player.euler.copy(e);          // 讓遊戲原本用 player.euler 的判斷照常運作
    if (Math.abs(cam.fov - 62) > 0.1) { cam.fov += (62 - cam.fov) * 0.2; cam.updateProjectionMatrix(); }
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
