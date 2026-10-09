/**
 * 有人來跟玩家說話時，把視角平滑轉向對方的臉 (所有關卡共用)。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from './legacy';

let anim = 0;

export function faceObject(app: GameApp, obj: THREE.Object3D, dur = 0.45) {
  const p = app.player as AnyObj;
  if (!obj) return;
  // 路人模型面向 +X：先轉身面對玩家 (就算玩家鏡頭不能轉也要轉)
  if (obj.userData?.type === 'npc') obj.rotation.y = Math.atan2(-(p.position.z - obj.position.z), p.position.x - obj.position.x);
  if (p.externalControl || p.isDroneMode) return; // 開車、儀器操作、過場中，玩家鏡頭不轉
  const box = new THREE.Box3().setFromObject(obj);
  const wp = obj.getWorldPosition(new THREE.Vector3());
  let tx = wp.x, tz = wp.z, ty = wp.y + (obj.userData?.dog ? 0.5 : 1.55);
  const h = box.max.y - box.min.y;
  // 身上有扛東西時外框會被撐大，只在外框合理時才用它
  if (!box.isEmpty() && Number.isFinite(h) && h < 2.2 && Math.hypot((box.min.x + box.max.x) / 2 - wp.x, (box.min.z + box.max.z) / 2 - wp.z) < 0.6) {
    tx = (box.min.x + box.max.x) / 2; tz = (box.min.z + box.max.z) / 2;
    ty = box.max.y - h * (h < 1 ? 0.35 : 0.1); // 狗看身體，人看臉
  }
  const eye = p.position as THREE.Vector3;
  const dx = tx - eye.x, dz = tz - eye.z, dy = ty - eye.y;
  const flat = Math.hypot(dx, dz);
  if (flat < 0.05) return;
  const yaw1 = Math.atan2(-dx, -dz);
  // 臉放在畫面上方約 1/4 處，下方留給對話框
  const pitch1 = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, flat) - 0.28));
  const yaw0 = p.euler.y, pitch0 = p.euler.x;
  let dyaw = (yaw1 - yaw0) % (Math.PI * 2);
  if (dyaw > Math.PI) dyaw -= Math.PI * 2;
  if (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const t0 = performance.now();
  const id = ++anim;
  const step = () => {
    if (id !== anim) return;
    const k = Math.min(1, (performance.now() - t0) / (dur * 1000));
    const e = k * k * (3 - 2 * k);
    p.euler.y = yaw0 + dyaw * e;
    p.euler.x = pitch0 + (pitch1 - pitch0) * e;
    p.camera.quaternion.setFromEuler(p.euler);
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}
