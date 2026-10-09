/**
 * 點地走路用的局部格狀 A*：
 * 以玩家與目標的外框各擴 PAD 公尺、格距 CELL，障礙就是桌機版已經有的圓形碰撞。
 * 路徑最後再用視線 (LOS) 拉直；fieldDay.collidePlayer 仍是最後防線。
 */
export interface Circle { x: number; z: number; r: number }

const CELL = 0.5;
const PAD = 8;
const MAX_N = 140;
/** 玩家半徑 + 一點餘裕 */
const BODY = 0.38;

function blockedAt(x: number, z: number, obs: Circle[]): boolean {
  for (const o of obs) {
    const dx = x - o.x, dz = z - o.z;
    const m = o.r + BODY;
    if (dx * dx + dz * dz < m * m) return true;
  }
  return false;
}

function los(ax: number, az: number, bx: number, bz: number, obs: Circle[]): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.25));
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (blockedAt(ax + (bx - ax) * k, az + (bz - az) * k, obs)) return false;
  }
  return true;
}

/** 找一條從 (ax,az) 到 (bx,bz) 的路；回傳轉折點 (不含起點)；找不到就直線 */
export function findPath(ax: number, az: number, bx: number, bz: number, obstacles: Circle[]): { x: number; z: number }[] {
  // 只保留可能相關的障礙
  const minX = Math.min(ax, bx) - PAD, maxX = Math.max(ax, bx) + PAD;
  const minZ = Math.min(az, bz) - PAD, maxZ = Math.max(az, bz) + PAD;
  const obs = obstacles.filter(o => o.x + o.r > minX && o.x - o.r < maxX && o.z + o.r > minZ && o.z - o.r < maxZ);
  if (!obs.length || los(ax, az, bx, bz, obs)) return [{ x: bx, z: bz }];

  // 格子
  let nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  let cell = CELL;
  if (nx > MAX_N || nz > MAX_N) { cell = Math.max((maxX - minX) / MAX_N, (maxZ - minZ) / MAX_N); nx = Math.ceil((maxX - minX) / cell); nz = Math.ceil((maxZ - minZ) / cell); }
  const idx = (ix: number, iz: number) => ix * nz + iz;
  const px = (ix: number) => minX + (ix + 0.5) * cell;
  const pz = (iz: number) => minZ + (iz + 0.5) * cell;
  const blocked = new Uint8Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) if (blockedAt(px(ix), pz(iz), obs)) blocked[idx(ix, iz)] = 1;

  const sx = Math.min(nx - 1, Math.max(0, Math.floor((ax - minX) / cell))), sz = Math.min(nz - 1, Math.max(0, Math.floor((az - minZ) / cell)));
  let gx = Math.min(nx - 1, Math.max(0, Math.floor((bx - minX) / cell))), gz = Math.min(nz - 1, Math.max(0, Math.floor((bz - minZ) / cell)));
  // 目標在障礙裡 (例如點到車身)：找最近的可走格
  if (blocked[idx(gx, gz)]) {
    let best = -1, bd = Infinity;
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      if (blocked[idx(ix, iz)]) continue;
      const d = (ix - gx) * (ix - gx) + (iz - gz) * (iz - gz);
      if (d < bd) { bd = d; best = idx(ix, iz); }
    }
    if (best < 0) return [{ x: bx, z: bz }];
    gx = Math.floor(best / nz); gz = best % nz;
  }
  blocked[idx(sx, sz)] = 0;

  // A*
  const N = nx * nz;
  const g = new Float32Array(N).fill(Infinity);
  const f = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open: number[] = [];
  const h = (ix: number, iz: number) => Math.hypot(ix - gx, iz - gz);
  const s0 = idx(sx, sz);
  g[s0] = 0; f[s0] = h(sx, sz); open.push(s0);
  const goal = idx(gx, gz);
  let found = false;
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  let guard = 0;
  while (open.length && guard++ < 60000) {
    // 取 f 最小 (格子不大，線性掃就好)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) { found = true; break; }
    closed[cur] = 1;
    const cx = Math.floor(cur / nz), cz = cur % nz;
    for (const [dx, dz, cost] of DIRS) {
      const ix = cx + dx, iz = cz + dz;
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
      const ni = idx(ix, iz);
      if (blocked[ni] || closed[ni]) continue;
      // 斜走不穿角
      if (dx && dz && (blocked[idx(cx + dx, cz)] || blocked[idx(cx, cz + dz)])) continue;
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng; f[ni] = ng + h(ix, iz); from[ni] = cur;
        if (!open.includes(ni)) open.push(ni);
      }
    }
  }
  if (!found) return [{ x: bx, z: bz }];
  const cells: { x: number; z: number }[] = [];
  for (let c = goal; c !== -1 && c !== s0; c = from[c]) cells.push({ x: px(Math.floor(c / nz)), z: pz(c % nz) });
  cells.reverse();
  // 終點用真正的目標點 (如果它不在障礙裡)
  if (!blockedAt(bx, bz, obs)) cells[cells.length - 1] = { x: bx, z: bz };
  // 視線拉直
  const out: { x: number; z: number }[] = [];
  let cx = ax, cz = az, i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !los(cx, cz, cells[j].x, cells[j].z, obs)) j--;
    out.push(cells[j]);
    cx = cells[j].x; cz = cells[j].z;
    i = j + 1;
  }
  return out;
}
