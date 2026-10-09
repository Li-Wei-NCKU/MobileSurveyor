/**
 * 手機版玩家：取代舊版 SurveyPlayer (第一人稱、鍵盤滑鼠)。
 * 介面維持一致 (position / euler / camera / keys / externalControl / isModalOpen …)，
 * 外業系統 (fieldDay、事件) 完全不用改；差別是：
 *   - 畫面上有玩家人偶 (第三人稱斜俯視)，手上的東西掛在人偶的手上 (player.hand)
 *   - 走路是「點地 → 自動尋路 → 沿路徑走」
 *   - 沒有準心；互動由 input.ts 點到物件後，走到旁邊自動呼叫 onInteract
 */
import * as THREE from 'three';
import type { AnyObj } from '../field/legacy';
import { buildPerson, animateWalk } from '../field/npc';
import { findPath, type Circle } from './pathfind';

export interface WalkTarget {
  x: number; z: number;
  /** 走到距離目標多近就算到了 */
  reach: number;
  /** 跟著會動的東西 (NPC) */
  follow?: THREE.Object3D | null;
  onArrive?: () => void;
  label?: string;
}

export class MobilePlayer {
  surveyScene: AnyObj;
  camera: THREE.PerspectiveCamera;
  onInteract: (obj: THREE.Object3D) => void;

  position = new THREE.Vector3(0, 1.65, 5);
  velocity = new THREE.Vector3();
  euler = new THREE.Euler(0, 0, 0, 'YXZ');
  isLocked = false;
  moveSpeed = 4.5;
  sprintMultiplier = 1.6;
  keys: Record<string, boolean> = { forward: false, backward: false, left: false, right: false, sprint: false, jump: false, droneUp: false, droneDown: false };
  /** 開車用的連續輸入 (方向盤滑桿) */
  axes = { steer: 0, throttle: 0, brake: false };
  raycaster = new THREE.Raycaster();
  crosshairRay = new THREE.Vector2(0, 0);
  hoveredObject: THREE.Object3D | null = null;
  isDroneMode = false;
  externalControl: ((dt: number) => void) | null = null;
  carrySpeedFactor = 1;
  noSprint = false;
  /** 點地面時記下的位置 (第 2/3 天的 groundAim 用) */
  aimPoint: THREE.Vector3 | null = null;

  /** 人偶 */
  avatar: THREE.Group;
  /** 右手 / 左手：手持物掛在這裡 */
  hand = new THREE.Object3D();
  handL = new THREE.Object3D();
  private walkT = 0;
  /** 目前路徑 (世界座標)，走完就空 */
  path: { x: number; z: number }[] = [];
  target: WalkTarget | null = null;
  private repathT = 0;
  /** 取得障礙 (由 mobile/index 設定成 fieldDay.walkBlockers) */
  blockers: () => Circle[] = () => [];
  /** 人偶面向 (世界 yaw：面向 +X 時為 0) */
  private facing = 0;
  /** 只讓人偶轉向某點一下 (對話時) */
  faceAt: { x: number; z: number } | null = null;

  constructor(surveyScene: AnyObj, onInteract: (obj: THREE.Object3D) => void) {
    this.surveyScene = surveyScene;
    this.camera = surveyScene.camera;
    this.onInteract = onInteract;
    this.avatar = buildPerson({ shirt: 0xff8f00, pants: 0x37474f, hat: 'cap', skin: 0xd4a07a });
    this.avatar.userData.type = 'player';
    // 右手：手肘前方；左手：身側
    this.hand.position.set(0.42, 0.95, 0.26);
    this.handL.position.set(0.1, 0.72, -0.3);
    this.avatar.add(this.hand, this.handL);
    this.avatar.visible = false;
    surveyScene.scene.add(this.avatar);
    this.syncAvatar();
  }

  isModalOpen(): boolean {
    return document.querySelectorAll('.modal-backdrop.show, #telescope-overlay.active, .m-sheet.open').length > 0
      || document.body.classList.contains('bench-active') || document.body.classList.contains('cine-active');
  }

  hidePrompt() {
    const promptEl = document.getElementById('interaction-prompt');
    if (promptEl) promptEl.style.display = 'none';
  }

  triggerInteraction() {
    if (this.hoveredObject) this.onInteract(this.hoveredObject);
  }

  setDroneMode(enabled: boolean) { this.isDroneMode = enabled; }

  /** 走去某個點 / 某個東西旁邊 */
  walkTo(t: WalkTarget) {
    this.target = t;
    this.repathT = 0;
    this.replan();
  }
  cancelWalk() { this.target = null; this.path = []; }
  get walking() { return !!this.target; }

  private replan() {
    const t = this.target;
    if (!t) return;
    if (t.follow) { t.x = t.follow.position.x; t.z = t.follow.position.z; }
    this.path = findPath(this.position.x, this.position.z, t.x, t.z, this.blockers());
  }

  /** 瞬間把人偶擺到 position 上 (讀檔、下車) */
  syncAvatar() {
    const gh = this.surveyScene.heightAt ? this.surveyScene.heightAt(this.position.x, this.position.z) : 0;
    this.avatar.position.set(this.position.x, gh, this.position.z);
    this.avatar.rotation.y = this.facing;
  }

  update(delta: number) {
    if (this.externalControl) { this.externalControl(delta); return; }
    this.updateWalking(delta);
  }

  private updateWalking(delta: number) {
    const t = this.target;
    let moving = 0;
    if (t && !this.isModalOpen()) {
      if (t.follow) {
        this.repathT -= delta;
        if (this.repathT <= 0) { this.repathT = 0.5; this.replan(); }
      }
      const dxT = t.x - this.position.x, dzT = t.z - this.position.z, dT = Math.hypot(dxT, dzT);
      if (dT <= t.reach || !this.path.length) {
        // 到了：面向目標
        if (dT > 0.05) this.facing = Math.atan2(-dzT, dxT);
        const f = t.onArrive;
        this.target = null; this.path = [];
        f?.();
      } else {
        const wp = this.path[0];
        const dx = wp.x - this.position.x, dz = wp.z - this.position.z, d = Math.hypot(dx, dz);
        const speed = this.moveSpeed * (this.carrySpeedFactor || 1) * (this.noSprint ? 1 : (dT > 6 ? 1.35 : 1));
        const st = Math.min(d, speed * delta);
        if (d > 1e-3) {
          this.position.x += dx / d * st; this.position.z += dz / d * st;
          this.facing = Math.atan2(-dz, dx);
          // euler 跟著面向 (有些程式用 euler.y 算「前方」)
          this.euler.y = Math.atan2(-dx, -dz);
          moving = speed / 1.5;
        }
        if (d - st < 0.05) this.path.shift();
      }
    }
    if (!moving && this.faceAt) {
      const dx = this.faceAt.x - this.position.x, dz = this.faceAt.z - this.position.z;
      if (Math.hypot(dx, dz) > 0.05) this.facing = Math.atan2(-dz, dx);
    }
    // 貼地 (眼高 1.65m)
    const gh = this.surveyScene.heightAt ? this.surveyScene.heightAt(this.position.x, this.position.z) : 0;
    this.position.y = gh + 1.65;
    this.walkT += delta;
    this.avatar.position.set(this.position.x, gh, this.position.z);
    // 轉身平滑
    let dy = (this.facing - this.avatar.rotation.y) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
    this.avatar.rotation.y += dy * Math.min(1, delta * 12);
    animateWalk(this.avatar, this.walkT, moving);
  }
}

(window as AnyObj).SurveyPlayer = MobilePlayer;
