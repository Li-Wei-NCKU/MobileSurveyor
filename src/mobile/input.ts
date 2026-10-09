/**
 * 觸控輸入：點場景 → 判斷點到什麼 → 走過去 / 互動。
 *  1. 可互動物件 (sm.interactiveObjects 且目前關卡給得出 prompt) → 走到旁邊自動執行 onInteract
 *  2. 其他 → 走到地面那個點 (並記下 player.aimPoint)
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import type { MobilePlayer } from './player';
import type { FollowCamera } from './camera';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class TouchInput {
  private down: { x: number; y: number; t: number; id: number } | null = null;
  private marker: THREE.Mesh;
  private markerT = 0;
  private chip: HTMLElement;
  enabled = true;

  constructor(private app: GameApp, private player: MobilePlayer, private cam: FollowCamera) {
    const canvas = app.sceneManager.renderer.domElement as HTMLCanvasElement;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { if (e.isPrimary) this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.down; this.down = null;
      if (!d || d.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14 || performance.now() - d.t > 600) return;
      this.tap(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointercancel', () => { this.down = null; });
    // 落點標記
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 9;
    this.marker.visible = false;
    app.sceneManager.scene.add(this.marker);
    this.chip = document.createElement('div');
    this.chip.className = 'm-walkchip';
    document.body.appendChild(this.chip);
  }

  /** 每幀：落點標記縮小消失、前往提示 */
  update(dt: number) {
    if (this.marker.visible) {
      this.markerT += dt;
      const s = 1 + this.markerT * 0.6;
      this.marker.scale.set(s, s, 1);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - this.markerT * 1.2);
      if (this.markerT > 0.8) this.marker.visible = false;
    }
    const t = this.player.target;
    const show = !!t && !!t.label && !this.player.isModalOpen();
    this.chip.classList.toggle('show', show);
    if (show) this.chip.textContent = t!.label!;
  }

  private tap(sx: number, sy: number) {
    if (!this.enabled || this.player.isModalOpen() || this.player.externalControl) return;
    const sm = this.app.sceneManager as AnyObj;
    const ray = this.cam.rayFromScreen(sx, sy);
    this.player.raycaster = ray;
    const lvl = this.app.currentLevelObj;
    // 1. 可互動物件
    const hits = ray.intersectObjects(sm.interactiveObjects, true);
    for (const h of hits) {
      let obj = h.object as THREE.Object3D;
      while (obj.parent && !obj.userData.type && obj.parent !== sm.scene) obj = obj.parent;
      if (!obj.userData?.type) continue;
      const prompt = lvl?.getInteractionPrompt ? lvl.getInteractionPrompt(obj) : null;
      if (!prompt) continue;
      this.goInteract(obj, h.point, prompt);
      return;
    }
    // 1b. 沒點中但很靠近某個可互動的小東西 (螢幕上 44 px 內)：手指沒那麼準
    const cam = sm.camera as THREE.PerspectiveCamera;
    let best: { obj: THREE.Object3D; d: number; prompt: string } | null = null;
    const tmp = V();
    for (const o of sm.interactiveObjects as THREE.Object3D[]) {
      if (!o.userData?.type || !o.visible) continue;
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) continue;
      box.getCenter(tmp).project(cam);
      if (tmp.z > 1) continue;
      const px = (tmp.x + 1) / 2 * innerWidth, py = (1 - tmp.y) / 2 * innerHeight;
      const d = Math.hypot(px - sx, py - sy);
      if (d > 44 || (best && d >= best.d)) continue;
      const prompt = lvl?.getInteractionPrompt ? lvl.getInteractionPrompt(o) : null;
      if (prompt) best = { obj: o, d, prompt };
    }
    if (best) { this.goInteract(best.obj, best.obj.getWorldPosition(V()), best.prompt); return; }
    // 2. 地面
    const g = this.groundHit(ray);
    if (!g) return;
    this.player.aimPoint = g.clone();
    this.showMarker(g);
    this.player.walkTo({ x: g.x, z: g.z, reach: 0.35 });
  }

  /** 沿射線找地面 (用 heightAt，不用真的 mesh) */
  groundHit(ray: THREE.Raycaster): THREE.Vector3 | null {
    const sm = this.app.sceneManager as AnyObj;
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y >= 0) return null;
    let prev = o.clone();
    for (let t = 0.5; t < 80; t += 0.5) {
      const q = o.clone().addScaledVector(d, t);
      if (q.y <= sm.heightAt(q.x, q.z)) {
        // 二分一下
        let lo = prev, hi = q;
        for (let i = 0; i < 6; i++) { const m = lo.clone().lerp(hi, 0.5); if (m.y <= sm.heightAt(m.x, m.z)) hi = m; else lo = m; }
        hi.y = sm.heightAt(hi.x, hi.z);
        return hi;
      }
      prev = q;
    }
    return null;
  }

  private showMarker(p: THREE.Vector3) {
    this.marker.position.set(p.x, p.y + 0.08, p.z);
    this.marker.visible = true;
    this.markerT = 0;
    this.marker.scale.set(1, 1, 1);
  }

  /** 走到物件旁邊再互動 */
  goInteract(obj: THREE.Object3D, point: THREE.Vector3, label: string) {
    const ud = obj.userData || {};
    // 大物件 (車、貨架) 用點到的位置；小東西 / 人用物件中心
    const big = ['truck', 'truck_bed', 'shelf', 'trunk_item'].includes(ud.type);
    const wp = big ? point.clone() : obj.getWorldPosition(V());
    const isNpc = ud.type === 'npc';
    const reach = isNpc ? 2.0 : big ? 2.2 : 1.7;
    const p = this.player.position;
    this.player.walkTo({
      x: wp.x, z: wp.z, reach, follow: isNpc ? obj : null, label,
      onArrive: () => {
        if (this.player.isModalOpen()) return;
        // 走到旁邊之後再確認一次 prompt (狀態可能變了)
        const lvl = this.app.currentLevelObj;
        const pr = lvl?.getInteractionPrompt ? lvl.getInteractionPrompt(obj) : null;
        if (!pr) return;
        this.player.hoveredObject = obj;
        this.player.raycaster.set(V(p.x, p.y, p.z), wp.clone().sub(V(p.x, p.y, p.z)).normalize());
        this.app.handleInteraction(obj);
        this.player.hoveredObject = null;
      },
    });
  }
}
