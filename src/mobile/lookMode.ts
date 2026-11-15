/**
 * 手機版的「自己瞄」模式：拍點位照片時，鏡頭從 2.5D 追隨切成第一人稱。
 *  - 有動作感測器：像 AR 一樣，手機轉到哪裡、鏡頭就看到哪裡 (左右拖畫面可以直接轉身)
 *  - 沒有感測器：用手指拖動轉頭 (左右轉、上下抬)
 * 兩指或右邊的鍵可以變焦 (廣角 ↔ 望遠)。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import type { MobilePlayer } from './player';
import { tiltEnable, tiltLive, tiltQuat } from './tilt';

let stop: (() => void) | null = null;

const FOV_WIDE = 72, FOV_TELE = 20, FOV_DEF = 62;

export function lookActive() { return !!stop; }

/** 取景選項：扶尺的 AR 畫面不能走動、不能變焦，手指要留給扶尺 (不攔截觸控) */
export interface LookOpt { move?: boolean; zoom?: boolean; drag?: boolean; tip?: string; /** 鏡頭位置 (不給就是玩家眼睛) */ eye?: () => THREE.Vector3 | null }

export function startLook(app: GameApp, player: MobilePlayer, opt: LookOpt = {}) {
  if (stop) return;
  const { move = true, zoom = true, drag = true } = opt;
  tiltEnable();
  const cam = app.sceneManager.camera as THREE.PerspectiveCamera;
  const savedCtl = player.externalControl;
  const savedFov = cam.fov;
  const e = new THREE.Euler(player.euler.x, player.euler.y, 0, 'YXZ');
  let fov = FOV_DEF;
  const pad = document.createElement('div');
  pad.className = 'm-look';
  if (!drag) pad.classList.add('nodrag');
  pad.innerHTML = `
    ${opt.tip === '' ? '' : `<span class="m-look-tip">${opt.tip || '拖曳畫面取景・兩指縮放'}</span>`}
    ${move ? `<div class="m-look-move">
      <button type="button" data-m="1">前進</button>
      <button type="button" data-m="-1">後退</button>
    </div>` : ''}
    <div class="m-look-zoom"${zoom ? '' : ' hidden'}>
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

  // 前進／後退：站的位置不好拍 (太近、太遠、被擋住) 時，不用收起手機就能挪位置。按住會一直走
  let moveDir = 0, moveMin = 0, lastDir = 1;
  pad.querySelectorAll<HTMLButtonElement>('button[data-m]').forEach(b => {
    const on = (ev: PointerEvent) => { ev.preventDefault(); ev.stopPropagation(); moveDir = lastDir = +b.dataset.m!; moveMin = 0.35; b.classList.add('down'); try { b.setPointerCapture(ev.pointerId); } catch { /* 合成事件 */ } };
    const off = (ev: PointerEvent) => { ev.stopPropagation(); if (+b.dataset.m! === moveDir) moveDir = 0; b.classList.remove('down'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
  });
  const sm = app.sceneManager as AnyObj;
  const step = (dist: number, dir: number) => {
    const fx = -Math.sin(e.y) * dir, fz = -Math.cos(e.y) * dir;
    const nx = player.position.x + fx * dist, nz = player.position.z + fz * dist;
    // 撞到東西 (車、樹、房子、儀器) 就停
    const px = player.position.x, pz = player.position.z;
    if (player.blockers().some(c => { const dn = Math.hypot(nx - c.x, nz - c.z); return dn < c.r + 0.25 && dn < Math.hypot(px - c.x, pz - c.z); })) return false;
    player.position.x = nx; player.position.z = nz;
    player.position.y = (sm.heightAt ? sm.heightAt(nx, nz) : 0) + 1.65;
    return true;
  };

  // 拖曳轉頭 ＋ 兩指縮放
  const pts = new Map<number, { x: number; y: number }>();
  let pinch0 = 0, fov0 = fov;
  const isBtn = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.m-look-zoom, .m-look-move');
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
    if (gyro) yawOff -= (ev.clientX - prev.x) * k;   // AR 模式：拖畫面只轉身，上下靠手機
    else {
      e.y -= (ev.clientX - prev.x) * k;
      e.x = THREE.MathUtils.clamp(e.x - (ev.clientY - prev.y) * k, -1.2, 1.1);
    }
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  });
  const up = (ev: PointerEvent) => {
    pts.delete(ev.pointerId);
    if (!pts.size) pad.classList.remove('on');
    try { pad.releasePointerCapture(ev.pointerId); } catch { /* 合成事件 */ }
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);

  // AR 模式 (動作感測器)
  let gyro = false, yawOff = 0;
  const qd = new THREE.Quaternion(), qy = new THREE.Quaternion(), qt = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), e2 = new THREE.Euler(0, 0, 0, 'YXZ');
  const tip = (pad.querySelector('.m-look-tip') || document.createElement('span')) as HTMLElement;
  const devYaw = () => {
    v.set(0, 0, -1).applyQuaternion(qd);
    if (Math.abs(v.y) > 0.8) v.set(0, 1, 0).applyQuaternion(qd);   // 手機幾乎朝下／朝上：改用手機上緣的方向
    return Math.atan2(-v.x, -v.z);
  };

  player.externalControl = (dt?: number) => {
    const d0 = Math.min(0.1, dt || 0.016);
    if (moveDir || moveMin > 0) {
      // 按一下至少走一小步，按住每秒走 1.4 m
      const want = Math.max(moveDir ? 1.4 * d0 : 0, moveMin);
      const dir = moveDir || lastDir;
      if (!step(want, dir)) moveMin = 0; else moveMin = Math.max(0, moveMin - want);
      if (moveDir) lastDir = moveDir;
    }
    cam.position.copy(opt.eye?.() ?? player.position);
    cam.up.set(0, 1, 0);
    const live = tiltLive();
    if (live) {
      tiltQuat(qd);
      if (!gyro) {
        // 剛開始：手機現在面對的方向 = 遊戲裡原本面對的方向 (已經自動轉向要拍的標)
        gyro = true; yawOff = e.y - devYaw();
        pad.classList.add('gyro'); if (opt.tip === undefined) tip.textContent = '轉動手機取景・兩指縮放';
      }
      qt.copy(qy.setFromAxisAngle(Y, yawOff)).multiply(qd);
      cam.quaternion.slerp(qt, 1 - Math.exp(-d0 * 22));   // 稍微平滑，濾掉手抖
      e2.setFromQuaternion(cam.quaternion, 'YXZ');
      e.x = THREE.MathUtils.clamp(e2.x, -1.5, 1.5); e.y = e2.y;
    } else {
      if (gyro) { gyro = false; pad.classList.remove('gyro'); if (opt.tip === undefined) tip.textContent = '拖曳畫面取景・兩指縮放'; }
      cam.quaternion.setFromEuler(e);
    }
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
  (window as AnyObj).__lookMode = (on: boolean, opt?: LookOpt) => { if (on) startLook(app, player, opt); else stopLook(); };
}
