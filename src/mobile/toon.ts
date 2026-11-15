/**
 * 卡通描邊畫風 (方案 C)。
 *  1. 色階上色：所有 MeshStandardMaterial 的受光量量化成幾階 (不換材質，遊戲原本改顏色／透明度的程式照常運作)
 *  2. 黑色描邊：主畫面畫完後，再用「背面外擴」把符合條件的物件畫一次黑邊
 *     - 外擴方向用平滑過的法線 (onrm)，方塊的稜角才不會裂開
 *     - 線寬固定幾個像素，遠近都一樣粗
 *     - 用 layer 1 標記要描邊的物件，不往場景裡加任何東西，遊戲的點選／遍歷不受影響
 * 低階手機只做色階，不描邊。
 */
import * as THREE from 'three';
import type { AnyObj } from '../field/legacy';

const OUTLINE_LAYER = 1;
/** 人物用：只描整個人的外輪廓 (描邊往後推一點，身體各部位之間的線就被自己擋住) */
const SOFT_LAYER = 2;
export const toonCfg = { on: true, outline: true, px: 1.5, step: 1.6 };

// ---------------------------------------------------------------- 1. 色階上色
const BAND = /* glsl */`
{
  // 受光量 (相對於底色) 取對數後四捨五入 → 幾個明暗階；邊界用 fwidth 抗鋸齒
  vec3 tBase = max(diffuseColor.rgb, vec3(0.012));
  vec3 tLit = max(outgoingLight - totalEmissiveRadiance, vec3(0.0));
  float tR = max(dot(tLit, vec3(0.299, 0.587, 0.114)) / dot(tBase, vec3(0.299, 0.587, 0.114)), 0.02);
  float tL = log(tR) / log(TOON_STEP) + 0.5;
  float tF = floor(tL), tW = max(fwidth(tL), 0.0001);
  float tQ = tF + smoothstep(0.0, max(tW * 1.5, 0.12), tL - tF) - 0.5;
  tQ = clamp(tQ, -3.0, 1.0);
  vec3 tTint = tLit / max(max(tLit.r, max(tLit.g, tLit.b)), 0.0001);
  vec3 tBaseTint = tBase / max(max(tBase.r, max(tBase.g, tBase.b)), 0.0001);
  // 保留一點光的色溫 (暖陽、陰天)，其餘用底色
  vec3 tCol = tBase * mix(vec3(1.0), tTint / max(tBaseTint, vec3(0.05)), 0.18);
  outgoingLight = tCol * pow(TOON_STEP, tQ) + totalEmissiveRadiance;
}
#include <opaque_fragment>`;

function patchStandard() {
  const proto = THREE.MeshStandardMaterial.prototype as AnyObj;
  if (proto.__toon) return;
  proto.__toon = true;
  proto.onBeforeCompile = function (shader: { fragmentShader: string }) {
    if (!toonCfg.on) return;
    shader.fragmentShader = `#define TOON_STEP ${toonCfg.step.toFixed(3)}\n` + shader.fragmentShader.replace('#include <opaque_fragment>', BAND);
  };
  proto.customProgramCacheKey = function () { return toonCfg.on ? 'toon' + toonCfg.step : ''; };
}

// ---------------------------------------------------------------- 2. 描邊
const outlineMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { res: { value: new THREE.Vector2(1, 1) }, px: { value: 1.5 }, push: { value: 0 } },
  vertexShader: /* glsl */`
    attribute vec3 onrm;
    uniform vec2 res; uniform float px; uniform float push;
    void main() {
      #ifdef USE_INSTANCING
        mat4 mm = modelMatrix * instanceMatrix;
      #else
        mat4 mm = modelMatrix;
      #endif
      vec4 wp = mm * vec4(position, 1.0);
      vec4 vp = viewMatrix * wp;
      vp.xyz += normalize(vp.xyz) * push;   // 沿視線往後推，畫面上的位置不變
      vec4 cp = projectionMatrix * vp;
      vec3 vn = normalize(mat3(viewMatrix) * mat3(mm) * onrm);
      vec2 d = vn.xy;
      float l = length(d);
      d = l > 0.0001 ? d / l * smoothstep(0.0, 0.25, l) : vec2(0.0);
      // 太遠的東西線細一點，免得糊成一團
      float w = px * clamp(60.0 / max(-vp.z, 1.0), 0.35, 1.0);
      cp.xy += d / res * 2.0 * w * cp.w;
      gl_Position = cp;
    }`,
  fragmentShader: 'void main(){ gl_FragColor = vec4(0.07, 0.08, 0.11, 1.0); }',
});
outlineMat.fog = false;
const softMat = outlineMat.clone();
softMat.uniforms.push.value = 0.3;
softMat.fog = false;

/** 幫幾何加上「平滑法線」屬性：同一個位置的頂點，法線取平均 */
function smoothNormals(geo: THREE.BufferGeometry): boolean {
  if (geo.getAttribute('onrm')) return true;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!pos || !nor || pos.count > 60000 || (pos as AnyObj).isInterleavedBufferAttribute) return false;
  const n = pos.count, out = new Float32Array(n * 3);
  const map = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
    let a = map.get(k);
    if (!a) { a = [0, 0, 0]; map.set(k, a); }
    // 同方向的法線只算一次 (不然一個面兩個三角形會加權兩次)
    const x = nor.getX(i), y = nor.getY(i), z = nor.getZ(i);
    let dup = false;
    for (let j = 3; j < a.length; j += 3) if (Math.abs(a[j] - x) + Math.abs(a[j + 1] - y) + Math.abs(a[j + 2] - z) < 0.02) { dup = true; break; }
    if (!dup) { a[0] += x; a[1] += y; a[2] += z; a.push(x, y, z); }
  }
  let i = 0;
  for (; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
    const a = map.get(k)!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  geo.setAttribute('onrm', new THREE.BufferAttribute(out, 3));
  return true;
}

const _size = new THREE.Vector3(), _sc = new THREE.Vector3();
const FLAT = new Set(['PlaneGeometry', 'CircleGeometry', 'RingGeometry', 'ShapeGeometry']);

/** 這個 mesh 要不要描邊 */
function eligible(m: THREE.Mesh): boolean {
  if (m.userData.noOutline) return false;
  const mat = m.material as THREE.Material | THREE.Material[];
  if (Array.isArray(mat)) return false;
  if (!(mat as AnyObj).isMeshStandardMaterial) return false;          // Basic 是標記、光圈、天空那一類
  if (mat.transparent || mat.opacity < 1 || mat.alphaTest > 0 || mat.depthWrite === false || mat.side === THREE.BackSide) return false;
  const geo = m.geometry;
  if (!geo || FLAT.has(geo.type)) return false;
  const im = m as unknown as THREE.InstancedMesh;
  if (im.isInstancedMesh && im.count > 400) return false;              // 草叢之類
  if (!geo.boundingBox) geo.computeBoundingBox();
  if (!geo.boundingBox) return false;
  geo.boundingBox.getSize(_size);
  m.getWorldScale(_sc);
  const sx = _size.x * Math.abs(_sc.x), sy = _size.y * Math.abs(_sc.y), sz = _size.z * Math.abs(_sc.z);
  const big = Math.max(sx, sy, sz), small = Math.min(sx, sy, sz);
  if (big > 45) return false;                                          // 地形、整條路
  if (sy < 0.035 && Math.max(sx, sz) > 0.5) return false;              // 貼在地上的薄片 (標線、鋪面)
  if (small < 0.004) return false;
  // 小零件 (螺絲、把手、燈) 不描：線比東西本身還粗，只會糊成黑點，又多一次繪製
  if (big < 0.22 && !m.userData.softOutline) return false;
  return true;
}

/** 離相機太遠的就不描 (遠處的線本來就細到看不太出來，省下繪製次數) */
const OUTLINE_DIST = 48;
const _wp = new THREE.Vector3();
// ---------------------------------------------------------------- 3. 合併描邊 (省繪製次數)
// 不會各自動的零件 (同一個父節點底下的 mesh) 描邊時合成一個：外觀一樣，繪製次數少很多。
// 合成的那個只放在描邊的 layer (主畫面、陰影、點選都看不到它)，原本的零件標成 noOutline。
const proxyMat = new THREE.MeshStandardMaterial({ colorWrite: false, depthWrite: false });
const _mt = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _v3 = new THREE.Vector3();
function mergeKids(node: THREE.Object3D) {
  const kids = node.children.filter(c => {
    const m = c as THREE.Mesh;
    return m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !m.userData.outlineProxy && m.visible && eligible(m);
  }) as THREE.Mesh[];
  for (const soft of [false, true]) {
    const set = kids.filter(k => !!k.userData.softOutline === soft && smoothNormals(k.geometry));
    if (set.length < 2) continue;
    let n = 0;
    const geos = set.map(k => { const g = k.geometry.index ? k.geometry.toNonIndexed() : k.geometry; n += g.getAttribute('position').count; return g; });
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    let o = 0;
    set.forEach((k, i) => {
      k.updateMatrix(); _mt.copy(k.matrix); _n3.getNormalMatrix(_mt);
      const P = geos[i].getAttribute('position'), N = geos[i].getAttribute('onrm');
      for (let j = 0; j < P.count; j++, o++) {
        _v3.fromBufferAttribute(P, j).applyMatrix4(_mt); pos[o * 3] = _v3.x; pos[o * 3 + 1] = _v3.y; pos[o * 3 + 2] = _v3.z;
        _v3.fromBufferAttribute(N, j).applyMatrix3(_n3).normalize(); nrm[o * 3] = _v3.x; nrm[o * 3 + 1] = _v3.y; nrm[o * 3 + 2] = _v3.z;
      }
      k.userData.noOutline = true;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('onrm', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('normal', g.getAttribute('onrm'));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const px = new THREE.Mesh(g, proxyMat);
    px.userData.outlineProxy = soft ? SOFT_LAYER : OUTLINE_LAYER;
    px.layers.set(px.userData.outlineProxy);
    px.castShadow = false; px.receiveShadow = false;
    node.add(px);
  }
}
/** 建好一組不會變形的模型 (器材、車身、人) 之後呼叫 */
export function mergeOutlines(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const nodes: THREE.Object3D[] = [];
  root.traverse(o => { if (!(o as THREE.Mesh).isMesh) nodes.push(o); });
  nodes.forEach(mergeKids);
}

let scanAt = 0;
function scan(scene: THREE.Scene, now: number, cam: THREE.Camera) {
  if (now < scanAt) return;
  scanAt = now + 350;
  const cp = cam.getWorldPosition(new THREE.Vector3());
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData.outlineProxy) {
      // 合併過的描邊：只看遠近
      const bs = m.geometry.boundingSphere!;
      _wp.copy(bs.center).applyMatrix4(m.matrixWorld);
      const on = _wp.distanceTo(cp) - bs.radius * m.matrixWorld.getMaxScaleOnAxis() < OUTLINE_DIST;
      m.layers.mask = on ? 1 << m.userData.outlineProxy : 0;
      return;
    }
    let near = true;
    if (!(m as unknown as THREE.InstancedMesh).isInstancedMesh && m.geometry) {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere;
      if (bs) { _wp.copy(bs.center).applyMatrix4(m.matrixWorld); near = _wp.distanceTo(cp) - bs.radius * m.matrixWorld.getMaxScaleOnAxis() < OUTLINE_DIST; }
    }
    const ok = near && eligible(m) && smoothNormals(m.geometry);
    const soft = !!m.userData.softOutline;
    if (ok && !soft) m.layers.enable(OUTLINE_LAYER); else m.layers.disable(OUTLINE_LAYER);
    if (ok && soft) m.layers.enable(SOFT_LAYER); else m.layers.disable(SOFT_LAYER);
  });
}

/** 場景建好後呼叫：包住 sm.render，在主畫面之後補一趟描邊 */
export function installToon(sm: AnyObj, low: boolean) {
  patchStandard();
  toonCfg.outline = !low;
  const r = sm.renderer as THREE.WebGLRenderer;
  const scene = sm.scene as THREE.Scene;
  const size = new THREE.Vector2();
  const orig = sm.render.bind(sm);
  const outlinePass = (cam: THREE.Camera) => {
    if (!toonCfg.on || !toonCfg.outline) return;
    scan(scene, performance.now(), cam);
    r.getDrawingBufferSize(size);
    for (const m of [outlineMat, softMat]) { m.uniforms.res.value.copy(size); m.uniforms.px.value = toonCfg.px * r.getPixelRatio(); }
    const bg = scene.background, ov = scene.overrideMaterial, ac = r.autoClear, sa = r.shadowMap.autoUpdate, mask = cam.layers.mask;
    scene.background = null; scene.overrideMaterial = outlineMat; r.autoClear = false; r.shadowMap.autoUpdate = false;
    try {
      cam.layers.set(OUTLINE_LAYER); r.render(scene, cam);
      scene.overrideMaterial = softMat; cam.layers.set(SOFT_LAYER); r.render(scene, cam);
    } finally {
      cam.layers.mask = mask; scene.background = bg; scene.overrideMaterial = ov; r.autoClear = ac; r.shadowMap.autoUpdate = sa;
    }
  };
  sm.render = () => { orig(); outlinePass(sm.camera as THREE.Camera); };
  // 測試／截圖用：用指定的相機畫一張 (含描邊)
  (window as AnyObj).__toonShot = (cam: THREE.Camera) => { r.render(scene, cam); outlinePass(cam); return r.domElement.toDataURL('image/png'); };
  (window as AnyObj).__toon = toonCfg;
}

patchStandard();
