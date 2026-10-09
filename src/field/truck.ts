/**
 * 可駕駛的測量作業車 (開放式後斗皮卡)
 * 車頭朝本地 +X，駕駛座在本地 -Z 側 (台灣左駕)。
 */
import * as THREE from 'three';
import { SM } from './legacy';
import { carGlass } from './npc';
import { CELL_X, CELL_Z, LAYER_H } from './itemModels';
import { footprint, type Placed } from './trunk';

const W = 1.82;
export const BED_X0 = -2.52;   // row 0 起點 (尾門內側)
export const BED_Z0 = -0.66;   // col 0 起點 (駕駛側)
export const BED_Y = 0.68;     // 後斗底板高度

export interface Circle { x: number; z: number; r: number; tag?: string }

export class FieldTruck {
  group = new THREE.Group();
  body = new THREE.Group();
  tailgate = new THREE.Group();
  bedItems = new THREE.Group();
  cabHit!: THREE.Mesh;
  tailHit!: THREE.Mesh;
  private wheels: THREE.Object3D[] = [];
  private steerPivots: THREE.Object3D[] = [];
  private tailOpen = 0;
  tailTarget = 0;

  // 駕駛狀態
  heading = 0;
  speed = 0;
  steer = 0;
  private camPos = new THREE.Vector3();
  private camInit = false;

  constructor(private heightAt: (x: number, z: number) => number) {
    this.build();
    this.group.add(this.body);
    this.body.add(this.bedItems);
  }

  get pos() { return this.group.position; }
  forward(): THREE.Vector3 { return new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading)); }

  /** 後斗格位 → 本地座標 (物品中心底部) */
  slotLocal(p: Pick<Placed, 'item' | 'col' | 'row' | 'layer' | 'rot'>): THREE.Vector3 {
    const { w, d } = footprint(p.item, p.rot);
    return new THREE.Vector3(BED_X0 + (p.row + d / 2) * CELL_X, BED_Y + p.layer * LAYER_H, BED_Z0 + (p.col + w / 2) * CELL_Z);
  }

  /** 本地 → 世界 */
  toWorld(lx: number, ly: number, lz: number): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.body.localToWorld(new THREE.Vector3(lx, ly, lz));
  }

  /** 世界 → 車身本地 (只用 heading，不含俯仰) */
  toLocalFlat(x: number, z: number): { lx: number; lz: number } {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return { lx: dx * c - dz * s, lz: dx * s + dz * c };
  }

  colliderCircles(): Circle[] {
    const f = this.forward();
    return [-1.7, 0, 1.7].map(o => ({ x: this.pos.x + f.x * o, z: this.pos.z + f.z * o, r: 1.0 }));
  }

  setPose(x: number, z: number, heading: number) {
    this.heading = heading;
    this.pos.set(x, this.heightAt(x, z), z);
    this.speed = 0;
    this.applyGround();
  }

  private applyGround() {
    const f = this.forward();
    const r = new THREE.Vector3(-f.z, 0, f.x); // 本地 +Z (右側)
    const x = this.pos.x, z = this.pos.z;
    const hf = this.heightAt(x + f.x * 1.6, z + f.z * 1.6), hb = this.heightAt(x - f.x * 1.6, z - f.z * 1.6);
    const hr = this.heightAt(x + r.x * 0.8, z + r.z * 0.8), hl = this.heightAt(x - r.x * 0.8, z - r.z * 0.8);
    this.pos.y = (hf + hb + hr + hl) / 4;
    this.group.rotation.set(0, 0, 0);
    this.group.rotation.order = 'YZX';
    this.group.rotation.y = this.heading;
    this.group.rotation.z = Math.atan2(hf - hb, 3.2);
    this.group.rotation.x = Math.atan2(hl - hr, 1.6);
  }

  /**
   * 推進駕駛物理 (簡易街機式)
   * input: throttle -1..1, steer -1..1 (正 = 左轉), brake 手煞車
   */
  drive(dt: number, input: { throttle: number; steer: number; brake: boolean }, maxSpeed: number, obstacles: Circle[], onHit: (c: Circle, impact: number) => void) {
    const accel = input.throttle > 0 ? (this.speed < -0.2 ? 14 : 5.5) : input.throttle < 0 ? (this.speed > 0.2 ? -14 : -3.5) : 0;
    this.speed += accel * dt;
    if (input.throttle === 0) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 2.2 * dt);
    if (input.brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 16 * dt);
    this.speed = Math.max(-5, Math.min(maxSpeed, this.speed));
    if (this.speed > maxSpeed) this.speed = maxSpeed;

    const targetSteer = input.steer * 0.55 * (1 - Math.min(0.55, Math.abs(this.speed) / 30));
    this.steer += (targetSteer - this.steer) * Math.min(1, dt * 6);
    this.heading += (this.speed / 3.2) * Math.tan(this.steer) * dt;

    const f = this.forward();
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += f.x * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;

    // 碰撞：車身三個圓 vs 障礙圓
    for (const c of this.colliderCircles()) {
      for (const o of obstacles) {
        const dx = c.x - o.x, dz = c.z - o.z, d = Math.hypot(dx, dz), min = c.r + o.r;
        if (d < min && d > 1e-4) {
          const impact = Math.abs(this.speed);
          this.pos.x = prevX + (dx / d) * 0.05;
          this.pos.z = prevZ + (dz / d) * 0.05;
          this.speed = -this.speed * 0.25;
          onHit(o, impact);
          break;
        }
      }
    }

    this.applyGround();
    const wheelSpin = (this.speed * dt) / 0.4;
    this.wheels.forEach(w => { w.rotation.z -= wheelSpin; });
    this.steerPivots.forEach(p => { p.rotation.y = this.steer; });
  }

  /** 追蹤攝影機 */
  updateChaseCam(cam: THREE.PerspectiveCamera, dt: number) {
    const f = this.forward();
    const want = new THREE.Vector3(this.pos.x - f.x * 8.5, this.pos.y + 3.6, this.pos.z - f.z * 8.5);
    if (!this.camInit) { this.camPos.copy(want); this.camInit = true; }
    this.camPos.lerp(want, Math.min(1, dt * 3.5));
    const minY = this.heightAt(this.camPos.x, this.camPos.z) + 1.2;
    if (this.camPos.y < minY) this.camPos.y = minY;
    cam.position.copy(this.camPos);
    cam.lookAt(this.pos.x + f.x * 5, this.pos.y + 1.2, this.pos.z + f.z * 5);
  }
  resetCam() { this.camInit = false; }

  update(dt: number) {
    this.tailOpen += (this.tailTarget - this.tailOpen) * Math.min(1, dt * 6);
    this.tailgate.rotation.z = this.tailOpen * (Math.PI / 2 - 0.05);
  }

  // ------------------------------------------------------------------
  private build() {
    const sm = SM();
    const M = sm.M;
    const g = this.body;
    const bev = 0.05;

    // 車身輪廓：後斗段只到底板高度
    const s = new THREE.Shape();
    s.moveTo(-2.62, 0.48);
    s.lineTo(-2.62, 0.63);
    s.lineTo(-0.72, 0.63);
    s.lineTo(-0.66, 1.78);
    s.lineTo(0.52, 1.8);
    s.quadraticCurveTo(0.72, 1.78, 1.12, 1.18);
    s.lineTo(2.42, 1.04);
    s.quadraticCurveTo(2.62, 1.0, 2.64, 0.78);
    s.lineTo(2.64, 0.48);
    s.lineTo(2.14, 0.48);
    s.absarc(1.62, 0.44, 0.52, 0, Math.PI, false);
    s.lineTo(-1.08, 0.48);
    s.absarc(-1.6, 0.44, 0.52, 0, Math.PI, false);
    s.lineTo(-2.62, 0.48);
    const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: W - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 16 });
    bodyGeo.translate(0, 0, -(W - bev * 2) / 2);
    g.add(sm.mk(bodyGeo, M.carPaint));

    // 後斗：防滑底板 + 側板
    const liner = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.95 });
    g.add(sm.mk(new THREE.BoxGeometry(1.86, 0.012, W - 0.16), liner, -1.66, BED_Y - 0.004, 0, true));
    [-1, 1].forEach(sd => {
      g.add(sm.mk(new THREE.BoxGeometry(1.9, 0.44, 0.07), M.carPaint, -1.67, BED_Y + 0.2, sd * (W / 2 - 0.035)));
      g.add(sm.mk(new THREE.BoxGeometry(1.9, 0.03, 0.1), M.darkGrey, -1.67, BED_Y + 0.43, sd * (W / 2 - 0.035), true));
    });
    // 尾門 (鉸鏈在底部)
    this.tailgate.position.set(-2.6, BED_Y - 0.02, 0);
    this.tailgate.add(sm.mk(new THREE.BoxGeometry(0.07, 0.44, W - 0.14), M.carPaint, 0, 0.22, 0));
    this.tailgate.add(sm.mk(new THREE.BoxGeometry(0.02, 0.06, 0.24), M.darkGrey, -0.04, 0.34, 0, true));
    const decalTail = sm.canvasTex(256, 64, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#0b3d6e'; c.font = 'bold 40px "Noto Sans TC","Microsoft JhengHei",sans-serif'; c.textAlign = 'center';
      c.fillText('鍵盤測量', w / 2, 46);
    });
    const tp = sm.mk(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshStandardMaterial({ map: decalTail, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }), -0.037, 0.2, 0, true);
    tp.rotation.y = -Math.PI / 2;
    this.tailgate.add(tp);
    g.add(this.tailgate);

    // 車窗
    const ws = new THREE.Shape();
    ws.moveTo(-0.6, 1.2); ws.lineTo(-0.56, 1.7); ws.lineTo(0.5, 1.72); ws.quadraticCurveTo(0.66, 1.7, 1.0, 1.2); ws.lineTo(-0.6, 1.2);
    const wg = new THREE.ExtrudeGeometry(ws, { depth: W + 0.012, bevelEnabled: false });
    wg.translate(0, 0, -(W + 0.012) / 2);
    g.add(sm.mk(wg, carGlass(), 0, 0, 0, true));
    g.add(sm.mk(new THREE.BoxGeometry(0.07, 0.5, W + 0.02), M.carPaint, 0.18, 1.45, 0, true));
    // 擋風玻璃：沿車身前窗的二次曲線取樣，往外偏移，做成彎曲玻璃 (雙面材質)
    {
      const P0 = [0.52, 1.8], C = [0.72, 1.78], P2 = [1.12, 1.18];
      const zw = W / 2 - 0.12, off = 0.062, N = 10;
      const pos: number[] = [], idx: number[] = [];
      const pts: number[][] = [];
      for (let i = 0; i <= N; i++) {
        const t = 0.1 + 0.8 * (i / N), u = 1 - t;
        const x = u * u * P0[0] + 2 * u * t * C[0] + t * t * P2[0];
        const y = u * u * P0[1] + 2 * u * t * C[1] + t * t * P2[1];
        const dx = 2 * u * (C[0] - P0[0]) + 2 * t * (P2[0] - C[0]);
        const dy = 2 * u * (C[1] - P0[1]) + 2 * t * (P2[1] - C[1]);
        const L = Math.hypot(dx, dy);
        // 曲線由車頂往車頭走 (dx>0, dy<0)，朝外 (前上方) 的法線為 (-dy, dx)
        pts.push([x + (-dy / L) * off, y + (dx / L) * off]);
      }
      pts.forEach(([x, y]) => pos.push(x, y, -zw, x, y, zw));
      for (let i = 0; i < N; i++) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
      const wsGeo = new THREE.BufferGeometry();
      wsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      wsGeo.setIndex(idx);
      wsGeo.computeVertexNormals();
      const b = pts[N];
      const wsMat = carGlass();
      g.add(sm.mk(wsGeo, wsMat, 0, 0, 0, true));
      // 雨刷
      [-0.35, 0.3].forEach(z => g.add(sm.mk(new THREE.BoxGeometry(0.02, 0.02, 0.62), M.black, b[0] - 0.04, b[1] + 0.03, z, true)));
    }
    const rear = sm.mk(new THREE.PlaneGeometry(W - 0.3, 0.42), carGlass(), -0.745, 1.47, 0, true);
    rear.rotation.y = -Math.PI / 2;
    g.add(rear);

    // 車頭
    g.add(sm.mk(sm.rbox(0.06, 0.32, 1.2, 0.02), M.darkGrey, 2.63, 0.84, 0));
    for (let i = 0; i < 4; i++) g.add(sm.mk(new THREE.BoxGeometry(0.02, 0.025, 1.1), M.aluDark, 2.665, 0.73 + i * 0.07, 0, true));
    g.add(sm.mk(sm.rbox(0.16, 0.18, W + 0.04, 0.04), M.darkGrey, 2.62, 0.5, 0));
    g.add(sm.mk(sm.rbox(0.12, 0.16, W + 0.02, 0.04), M.darkGrey, -2.64, 0.5, 0));
    const head = new THREE.MeshStandardMaterial({ color: 0xdfe8f0, roughness: 0.05, metalness: 0.6, emissive: 0x334455, emissiveIntensity: 0.4 });
    const tail = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.2, emissive: 0x550000, emissiveIntensity: 0.5 });
    [-1, 1].forEach(sd => {
      g.add(sm.mk(sm.rbox(0.05, 0.12, 0.3, 0.02), head, 2.6, 0.92, sd * 0.68, true));
      g.add(sm.mk(sm.rbox(0.04, 0.26, 0.1, 0.015), tail, -2.63, 0.86, sd * 0.84, true));
      g.add(sm.mk(sm.rbox(0.12, 0.13, 0.05, 0.02), M.darkGrey, 0.9, 1.3, sd * (W / 2 + 0.08)));
      [0.55, -0.25].forEach(x => g.add(sm.mk(new THREE.BoxGeometry(0.16, 0.03, 0.02), M.darkGrey, x, 1.12, sd * (W / 2 + 0.005), true)));
    });
    // 車牌 (前後各一，虛構號碼)
    const plateTex = sm.canvasTex(320, 150, (c, w, h) => {
      c.fillStyle = '#f7f7f2'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#111'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#111'; c.font = 'bold 84px "Arial Narrow", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('KBS-0705', w / 2, h / 2 + 4, w - 30);
      c.beginPath(); c.arc(28, 24, 6, 0, Math.PI * 2); c.arc(w - 28, 24, 6, 0, Math.PI * 2); c.fill();
    });
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.4, metalness: 0.3 });
    const front = sm.mk(new THREE.BoxGeometry(0.01, 0.15, 0.32), [plateMat, plateMat, M.alu, M.alu, M.alu, M.alu], 2.715, 0.5, 0, true);
    g.add(front);
    const back = sm.mk(new THREE.BoxGeometry(0.01, 0.15, 0.32), [plateMat, plateMat, M.alu, M.alu, M.alu, M.alu], -2.715, 0.5, 0, true);
    back.rotation.y = Math.PI;
    g.add(back);

    // 車頂警示燈
    g.add(sm.mk(sm.rbox(0.22, 0.08, 1.1, 0.03), M.black, 0.1, 1.885, 0));
    const beacon = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5, roughness: 0.2 });
    for (let i = 0; i < 4; i++) g.add(sm.mk(sm.rbox(0.18, 0.06, 0.2, 0.02), beacon, 0.1, 1.94, -0.36 + i * 0.24, true));
    // 車門標誌
    const decal = sm.canvasTex(512, 160, (c, w) => {
      c.clearRect(0, 0, w, 160);
      c.fillStyle = '#f26b0f'; c.fillRect(0, 118, w, 18);
      c.fillStyle = '#0b3d6e'; c.font = 'bold 60px "Noto Sans TC","Microsoft JhengHei",sans-serif';
      c.fillText('鍵盤測量有限公司', 10, 80);
      c.font = 'bold 24px sans-serif'; c.fillStyle = '#475569';
      c.fillText('紙上談兵 · 使命必達', 14, 112);
    });
    const decalMat = new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    [-1, 1].forEach(sd => {
      const d = sm.mk(new THREE.PlaneGeometry(1.6, 0.5), decalMat, 0.2, 0.84, sd * (W / 2 + 0.006), true);
      d.rotation.y = sd > 0 ? 0 : Math.PI;
      g.add(d);
    });

    // 車輪 (前輪可轉向)
    const tireGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 28).rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.29, 10).rotateX(Math.PI / 2);
    [1.62, -1.6].forEach((x, fi) => [-1, 1].forEach(sd => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.4, sd * (W / 2 - 0.12));
      const wheel = new THREE.Group();
      wheel.add(sm.mk(tireGeo, M.tire));
      wheel.add(sm.mk(rimGeo, M.alu, 0, 0, sd * 0.002));
      for (let k = 0; k < 5; k++) {
        const sp = sm.mk(new THREE.BoxGeometry(0.06, 0.4, 0.02), M.aluDark, 0, 0, sd * 0.148, true);
        sp.rotation.z = (k / 5) * Math.PI;
        wheel.add(sp);
      }
      pivot.add(wheel);
      g.add(pivot);
      this.wheels.push(wheel);
      if (fi === 0) this.steerPivots.push(pivot);
    }));

    // 互動用隱形碰撞盒
    const inv = new THREE.MeshBasicMaterial({ visible: false });
    this.cabHit = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, W + 0.2), inv);
    this.cabHit.position.set(0.95, 1.1, 0);
    this.cabHit.userData = { type: 'truck' };
    g.add(this.cabHit);
    // 後斗整區 (含尾門) 都可互動，不必瞄準特定設備
    this.tailHit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.1, W + 0.1), inv);
    this.tailHit.position.set(-1.72, 1.05, 0);
    this.tailHit.userData = { type: 'truck_bed' };
    g.add(this.tailHit);

    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
}
