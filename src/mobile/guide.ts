/**
 * 任務指引：畫面下方一直有一條「下一步要做什麼、在哪裡、多遠」，點了就自動走過去；
 * 目標地點在 3D 場景裡用黃圈＋箭頭標出來 (穿牆可見)，玩家不會不知道該往哪走。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import type { MobilePlayer } from './player';
import { toast } from '../field/ui';

export interface Goal { x: number; z: number; label: string; reach?: number; obj?: THREE.Object3D }

export class MobileGuide {
  private chip: HTMLButtonElement;
  private mark: THREE.Group;
  private ring: THREE.Mesh;
  private cone: THREE.Mesh;
  private goal: Goal | null = null;
  private t = 99;
  private bob = 0;
  private told = false;

  constructor(private app: GameApp, private field: FieldDay, private player: MobilePlayer) {
    this.chip = document.createElement('button');
    this.chip.type = 'button';
    this.chip.className = 'm-goal';
    this.chip.innerHTML = '<i class="m-goal-dir">➤</i><span class="m-goal-text"></span><b class="m-goal-dist"></b>';
    this.chip.onclick = (e) => { e.stopPropagation(); this.go(); };
    document.body.appendChild(this.chip);

    const mat = (c: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthTest: false });
    this.mark = new THREE.Group();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 36), mat(0xffd23f));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 8;
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 4), mat(0xffd23f));
    this.cone.rotation.x = Math.PI;
    this.cone.position.y = 1.9;
    this.cone.renderOrder = 8;
    this.mark.add(this.ring, this.cone);
    this.mark.visible = false;
    app.sceneManager.scene.add(this.mark);
  }

  /** 點提示 = 走過去，而且到了就直接做那件事 (開架子、開車門選單、撿起來…) */
  private go() {
    const g = this.goal;
    if (!g) return;
    const input = (window as AnyObj).__mobile?.input;
    if (g.obj && input?.goInteract) {
      const y = (this.app.sceneManager as AnyObj).heightAt?.(g.x, g.z) ?? 0;
      input.goInteract(g.obj, new THREE.Vector3(g.x, y + 0.5, g.z), g.label);
      return;
    }
    this.player.walkTo({ x: g.x, z: g.z, reach: g.reach ?? 1.2, label: g.label });
  }

  update(dt: number) {
    const fd = this.field as AnyObj;
    const on = this.app.currentLevelObj === this.field && !this.field.inTruck && !this.player.isModalOpen() && !this.player.externalControl;
    // 目標本身 0.25 s 算一次就好 (要掃陣列)
    this.t += dt;
    if (on && this.t > 0.25) { this.t = 0; this.goal = fd.guideTarget?.() || null; }
    if (!on) this.goal = null;
    const g = this.goal;
    if (g && !this.told) {
      this.told = true;
      toast('畫面下方的指引會說下一步要去哪，點它就會自動走過去。', 'info', 5200);
      setTimeout(() => toast('點左上角的任務提示，可以打開外業手簿看清單和進度。', 'info', 5200), 900);
    }
    // 正在走去某個地方時，交給走路提示 (m-walkchip)，兩個不要疊在一起
    const walking = !!this.player.target?.label;
    this.chip.classList.toggle('show', !!g && !walking);
    this.mark.visible = !!g;
    if (!g) return;
    const sm = this.app.sceneManager as AnyObj;
    const y = sm.heightAt?.(g.x, g.z) ?? 0;
    this.mark.position.set(g.x, y + 0.05, g.z);
    this.bob += dt * 3;
    this.cone.position.y = 1.75 + Math.sin(this.bob) * 0.18;
    this.ring.scale.setScalar(1 + Math.sin(this.bob) * 0.06);
    if (walking) return;
    const p = this.player.position;
    const d = Math.hypot(p.x - g.x, p.z - g.z);
    (this.chip.querySelector('.m-goal-text') as HTMLElement).textContent = g.label;
    (this.chip.querySelector('.m-goal-dist') as HTMLElement).textContent = `${d < 10 ? d.toFixed(1) : Math.round(d)} m`;
    // 箭頭指向目標 (在畫面外也看得出往哪邊)
    const cam = sm.camera as THREE.PerspectiveCamera;
    const v = new THREE.Vector3(g.x, y + 0.6, g.z).project(cam);
    const q = new THREE.Vector3(p.x, p.y, p.z).project(cam);
    const behind = v.z > 1;
    const dx = (v.x - q.x) * (behind ? -1 : 1), dy = -(v.y - q.y) * (behind ? -1 : 1);
    const ang = Math.abs(dx) + Math.abs(dy) < 1e-4 ? 0 : Math.atan2(dy, dx) * 180 / Math.PI;
    (this.chip.querySelector('.m-goal-dir') as HTMLElement).style.transform = `rotate(${ang.toFixed(0)}deg)`;
  }
}
