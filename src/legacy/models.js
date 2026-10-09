/**
 * SurveyModels — 精緻化程序建模庫 (Procedural detailed model library)
 * 所有測量儀器、道具、無人機與環境物件的建模函式集中於此。
 * Three.js r128 相容 (不使用 CapsuleGeometry 等新版 API)。
 */
(function () {
    'use strict';

    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const UP = V3(0, 1, 0);

    // ------------------------------------------------------------------
    // 數學工具：可重現亂數、雜訊
    // ------------------------------------------------------------------
    function rng(seed) {
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function hash2(x, y) {
        const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return h - Math.floor(h);
    }
    function hash3(x, y, z, s) {
        const h = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 997) * 78.233 + Math.round(z * 997) * 37.719 + s * 91.7) * 43758.5453;
        return h - Math.floor(h);
    }
    function vnoise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
        return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
    }
    function fbm(x, y, oct = 4) {
        let s = 0, a = 0.5, f = 1, n = 0;
        for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
        return s / n;
    }
    function smoothstep(a, b, x) {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    }

    // ------------------------------------------------------------------
    // 材質庫 (共用材質，避免重複建立)
    // ------------------------------------------------------------------
    const _mats = {};
    function std(key, opts) {
        if (!_mats[key]) _mats[key] = new THREE.MeshStandardMaterial(opts);
        return _mats[key];
    }
    const M = {
        get alu() { return std('alu', { color: 0xc4c9d0, roughness: 0.32, metalness: 0.85 }); },
        get aluDark() { return std('aluDark', { color: 0x5d636b, roughness: 0.38, metalness: 0.8 }); },
        get steel() { return std('steel', { color: 0x9aa1a9, roughness: 0.28, metalness: 0.92 }); },
        get brass() { return std('brass', { color: 0xc9a043, roughness: 0.28, metalness: 0.95 }); },
        get black() { return std('black', { color: 0x16181c, roughness: 0.55, metalness: 0.05 }); },
        get greyPlastic() { return std('greyPlastic', { color: 0x3f444c, roughness: 0.5, metalness: 0.05 }); },
        get darkGrey() { return std('darkGrey', { color: 0x2a2e35, roughness: 0.45, metalness: 0.1 }); },
        get rubber() { return std('rubber', { color: 0x0b0b0d, roughness: 0.92, metalness: 0.0 }); },
        get white() { return std('white', { color: 0xf1f2f0, roughness: 0.38, metalness: 0.02 }); },
        get cream() { return std('cream', { color: 0xe7e3d6, roughness: 0.42, metalness: 0.02 }); },
        get yellow() { return std('yellow', { color: 0xf2b705, roughness: 0.42, metalness: 0.05 }); },
        get orange() { return std('orange', { color: 0xf26b0f, roughness: 0.5, metalness: 0.02 }); },
        get red() { return std('red', { color: 0xd62828, roughness: 0.45, metalness: 0.02 }); },
        get blue() { return std('blue', { color: 0x0b6fb8, roughness: 0.4, metalness: 0.05 }); },
        get tripodLeg() { return std('tripodLeg', { color: 0xe9a514, roughness: 0.55, metalness: 0.05 }); },
        get glass() { return std('glass', { color: 0x10233a, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.6 }); },
        get lens() { return std('lens', { color: 0x2b4a7a, roughness: 0.02, metalness: 1.0, envMapIntensity: 2.0 }); },
        get carbon() { return std('carbon', { color: 0x1d2025, roughness: 0.35, metalness: 0.35 }); },
        get ledGreen() { return std('ledGreen', { color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.6 }); },
        get ledRed() { return std('ledRed', { color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.8 }); },
        get ledAmber() { return std('ledAmber', { color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.6 }); },
        get ledWhite() { return std('ledWhite', { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 }); },
        get bubble() { return std('bubble', { color: 0x9be15d, emissive: 0x3f7a12, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.2 }); },
        get wood() { return std('wood', { color: 0xa47a4c, roughness: 0.85 }); },
        get carPaint() { return std('carPaint', { color: 0xf4f5f3, roughness: 0.28, metalness: 0.25 }); },
        get tire() { return std('tire', { color: 0x151515, roughness: 0.95 }); },
        get canvasBlue() { return std('canvasBlue', { color: 0x1e5aa8, roughness: 0.85, side: THREE.DoubleSide }); },
        get vertexFlat() { return std('vertexFlat', { vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.0 }); },
        get vertexFlatDS() { return std('vertexFlatDS', { vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }); },
        get vertexSmooth() { return std('vertexSmooth', { vertexColors: true, roughness: 0.9, metalness: 0.0 }); }
    };

    let maxAniso = 4;

    // ------------------------------------------------------------------
    // 幾何工具
    // ------------------------------------------------------------------
    function mk(geo, mat, x = 0, y = 0, z = 0, noShadow = false) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = !noShadow;
        m.receiveShadow = true;
        return m;
    }

    /** 兩點之間的圓柱 (rA 在 a 端, rB 在 b 端) */
    function rodBetween(a, b, rA, rB, mat, seg = 10) {
        const d = new THREE.Vector3().subVectors(b, a);
        const L = d.length();
        const m = mk(new THREE.CylinderGeometry(rB, rA, L, seg), mat);
        m.position.copy(a).addScaledVector(d, 0.5);
        m.quaternion.setFromUnitVectors(UP, d.normalize());
        return m;
    }
    /** 兩點之間的方柱 */
    function boxBetween(a, b, w, dpt, mat) {
        const d = new THREE.Vector3().subVectors(b, a);
        const L = d.length();
        const m = mk(new THREE.BoxGeometry(w, L, dpt), mat);
        m.position.copy(a).addScaledVector(d, 0.5);
        m.quaternion.setFromUnitVectors(UP, d.normalize());
        return m;
    }

    function roundRectPath(p, x, y, w, h, r) {
        if (r < 1e-5) {
            p.moveTo(x, y); p.lineTo(x + w, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.lineTo(x, y);
            return p;
        }
        p.moveTo(x + r, y);
        p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
        p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
        p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y);
        return p;
    }

    /** 圓角方塊 (ExtrudeGeometry + bevel)，中心於原點 */
    const _rboxCache = {};
    function rbox(w, h, d, r = 0.01) {
        const key = [w, h, d, r].map(v => v.toFixed(4)).join('_');
        if (_rboxCache[key]) return _rboxCache[key];
        r = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
        const W = w - 2 * r, H = h - 2 * r;
        const s = new THREE.Shape();
        roundRectPath(s, -W / 2, -H / 2, W, H, Math.min(r, W / 2, H / 2) * 0.98);
        const g = new THREE.ExtrudeGeometry(s, {
            depth: Math.max(1e-4, d - 2 * r), bevelEnabled: true,
            bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 4
        });
        g.translate(0, 0, -(d - 2 * r) / 2);
        _rboxCache[key] = g;
        return g;
    }

    /** 圓角多邊形 Shape */
    function roundedPolyShape(n, R, cr, rot = Math.PI / 2) {
        const pts = [];
        for (let i = 0; i < n; i++) {
            const a = rot + i * Math.PI * 2 / n;
            pts.push(new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R));
        }
        const s = new THREE.Shape();
        for (let i = 0; i < n; i++) {
            const p = pts[i], prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
            const a = p.clone().add(prev.clone().sub(p).setLength(cr));
            const b = p.clone().add(next.clone().sub(p).setLength(cr));
            if (i === 0) s.moveTo(a.x, a.y); else s.lineTo(a.x, a.y);
            s.quadraticCurveTo(p.x, p.y, b.x, b.y);
        }
        s.closePath();
        return s;
    }
    /** 平板 (由 shape 往 +Y 擠出) */
    function plate(shape, thickness, bevel = 0.002) {
        const g = new THREE.ExtrudeGeometry(shape, {
            depth: thickness - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6
        });
        g.rotateX(-Math.PI / 2);
        g.translate(0, bevel, 0);
        return g;
    }

    function lathe(pts, seg = 32) {
        return new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);
    }

    function canvasTex(w, h, draw, opts = {}) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        draw(ctx, w, h);
        const t = new THREE.CanvasTexture(c);
        t.anisotropy = maxAniso;
        if (opts.repeat) {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(opts.repeat[0], opts.repeat[1]);
        }
        return t;
    }

    /** 以座標雜湊做頂點抖動 (共點頂點位移一致，不會裂開) */
    function jitter(geo, amt, seed = 0) {
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            p.setXYZ(i,
                x + (hash3(x, y, z, seed) - 0.5) * amt,
                y + (hash3(x, y, z, seed + 1.7) - 0.5) * amt,
                z + (hash3(x, y, z, seed + 3.1) - 0.5) * amt);
        }
        p.needsUpdate = true;
        return geo;
    }

    /**
     * 合併多個幾何並烘焙頂點色 → 單一 BufferGeometry (減少 draw calls)
     * parts: [{ geo, color: THREE.Color | (x,y,z)=>THREE.Color, matrix?: Matrix4 }]
     */
    function mergeColored(parts) {
        let total = 0;
        const prepared = parts.map(p => {
            let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
            if (p.matrix) g.applyMatrix4(p.matrix);
            if (!g.attributes.normal) g.computeVertexNormals();
            total += g.attributes.position.count;
            return { g, color: p.color };
        });
        const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
        let o = 0;
        const tmp = new THREE.Color();
        prepared.forEach(({ g, color }) => {
            const pa = g.attributes.position, n = pa.count;
            pos.set(pa.array, o * 3);
            nor.set(g.attributes.normal.array, o * 3);
            for (let i = 0; i < n; i++) {
                const c = (typeof color === 'function') ? color(pa.getX(i), pa.getY(i), pa.getZ(i), tmp) : color;
                col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b;
            }
            o += n;
            g.dispose();
        });
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        out.setAttribute('color', new THREE.BufferAttribute(col, 3));
        out.computeBoundingSphere();
        return out;
    }
    const mat4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
        new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));
    const col = (hex) => new THREE.Color(hex);
    function colVar(hex, r, amt = 0.08) {
        const c = new THREE.Color(hex);
        const hsl = {}; c.getHSL(hsl);
        c.setHSL(hsl.h + (r() - 0.5) * amt * 0.3, Math.min(1, hsl.s * (1 + (r() - 0.5) * amt)), Math.min(1, hsl.l * (1 + (r() - 0.5) * amt * 2)));
        return c;
    }

    // ==================================================================
    // 三腳架 + 基座 (Tripod & Tribrach)
    // ==================================================================
    function buildTripod(group, headY = 1.28) {
        const legs = [];
        // 架頭 (Tripod head) — 鋁合金圓盤 + 三個鉸鏈耳
        group.add(mk(lathe([[0, 0], [0.084, 0], [0.086, 0.006], [0.082, 0.036], [0.07, 0.04], [0, 0.04]], 36), M.aluDark, 0, headY - 0.04, 0));
        group.add(mk(new THREE.CylinderGeometry(0.03, 0.03, 0.002, 24), M.black, 0, headY + 0.0005, 0));
        // 中心連接螺旋 (Central fixing screw) 懸於架頭下方
        group.add(mk(new THREE.CylinderGeometry(0.007, 0.007, 0.13, 8), M.steel, 0, headY - 0.1, 0));
        group.add(mk(new THREE.CylinderGeometry(0.024, 0.024, 0.018, 16), M.black, 0, headY - 0.165, 0));

        for (let i = 0; i < 3; i++) {
            const a = i * Math.PI * 2 / 3 + Math.PI / 2;
            const out = V3(Math.cos(a), 0, Math.sin(a));
            const tan = V3(-Math.sin(a), 0, Math.cos(a));

            const lug = mk(new THREE.BoxGeometry(0.05, 0.034, 0.05), M.aluDark, out.x * 0.088, headY - 0.03, out.z * 0.088);
            lug.rotation.y = -a;
            group.add(lug);

            const hinge = V3(out.x * 0.1, headY - 0.045, out.z * 0.1);
            const foot = V3(out.x * 0.62, 0, out.z * 0.62);
            const dir = new THREE.Vector3().subVectors(foot, hinge);
            const L = dir.length();
            const u = dir.clone().normalize();
            const P = (t, side = 0) => hinge.clone().addScaledVector(u, L * t).addScaledVector(tan, side);

            // 上段雙軌木腳 (twin rails, survey-yellow)
            [-1, 1].forEach(s => group.add(boxBetween(P(0.015, s * 0.021), P(0.6, s * 0.021), 0.017, 0.032, M.tripodLeg)));
            // 鉸鏈軸
            group.add(rodBetween(P(0.01, -0.035), P(0.01, 0.035), 0.008, 0.008, M.steel, 8));
            // 上段橫撐
            group.add(boxBetween(P(0.3, -0.03), P(0.3, 0.03), 0.012, 0.02, M.black));
            // 伸縮固定夾 (leg clamp)
            const clamp = mk(new THREE.BoxGeometry(0.068, 0.07, 0.05), M.black);
            clamp.position.copy(P(0.6));
            clamp.quaternion.setFromUnitVectors(UP, u);
            group.add(clamp);
            group.add(rodBetween(P(0.6).addScaledVector(out, 0.02), P(0.6).addScaledVector(out, 0.055), 0.008, 0.008, M.steel, 8));
            const knob = mk(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12), M.black);
            knob.position.copy(P(0.6).addScaledVector(out, 0.06));
            knob.quaternion.setFromUnitVectors(UP, out);
            group.add(knob);
            // 下段伸縮鋁管 (lower aluminium extension)
            [-1, 1].forEach(s => group.add(boxBetween(P(0.55, s * 0.012), P(0.94, s * 0.012), 0.013, 0.02, M.aluDark)));
            group.add(boxBetween(P(0.92, -0.022), P(0.92, 0.022), 0.03, 0.03, M.black));
            // 腳踏 + 鋼尖 (foot step & steel spike)
            const step = mk(new THREE.BoxGeometry(0.05, 0.012, 0.035), M.steel);
            step.position.copy(P(0.92).addScaledVector(out, 0.03));
            step.rotation.y = -a;
            group.add(step);
            group.add(rodBetween(P(0.94), foot, 0.014, 0.002, M.steel, 8));

            legs.push({ P, a, out, tan, u, L });
        }
        return legs;
    }

    function buildTribrach(group, y0) {
        // 下板 (圓角三角形)
        const base = mk(plate(roundedPolyShape(3, 0.088, 0.03), 0.012), M.darkGrey, 0, y0, 0);
        group.add(base);
        // 三支整平螺旋 (foot screws)
        const knobs = [];
        for (let i = 0; i < 3; i++) {
            const a = Math.PI / 2 + i * Math.PI * 2 / 3;
            const x = Math.cos(a) * 0.058, z = -Math.sin(a) * 0.058;
            group.add(mk(new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 8), M.steel, x, y0 + 0.024, z));
            // 腳螺旋旋鈕 (可轉動；白色刻痕看得出轉了多少)
            const kg = new THREE.Group();
            kg.position.set(x, y0 + 0.022, z);
            kg.add(mk(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 18), M.black));
            kg.add(mk(new THREE.CylinderGeometry(0.0175, 0.0175, 0.003, 18), M.aluDark, 0, 0.007, 0));
            kg.add(mk(new THREE.BoxGeometry(0.008, 0.0125, 0.003), M.white, 0.0158, 0, 0, true));
            kg.add(mk(new THREE.BoxGeometry(0.008, 0.001, 0.003), M.white, 0.012, 0.0086, 0, true));
            group.add(kg);
            knobs.push(kg);
        }
        // 上板
        group.add(mk(plate(roundedPolyShape(3, 0.074, 0.028, -Math.PI / 2), 0.013), M.greyPlastic, 0, y0 + 0.037, 0));
        group.add(mk(new THREE.CylinderGeometry(0.038, 0.04, 0.012, 28), M.darkGrey, 0, y0 + 0.056, 0));
        // 圓盒水準器 (circular bubble)
        group.add(mk(new THREE.CylinderGeometry(0.013, 0.013, 0.008, 24), M.black, 0.044, y0 + 0.054, 0.03));
        group.add(mk(new THREE.CylinderGeometry(0.0105, 0.0105, 0.0006, 24), std('vialLiquid', { color: 0xb5cf2e, roughness: 0.2, emissive: 0x3a4a08, emissiveIntensity: 0.5 }), 0.044, y0 + 0.0582, 0.03, true));
        const bubble = mk(new THREE.SphereGeometry(0.0032, 14, 10), std('vialBubble', { color: 0xffffff, emissive: 0xd9f99d, emissiveIntensity: 0.45, roughness: 0.05, metalness: 0.0 }), 0.044, y0 + 0.0587, 0.03, true);
        bubble.scale.y = 0.35;
        group.add(bubble);
        // 玻璃上的刻劃圓 (氣泡要進這個圈才算平)
        const ring = mk(new THREE.TorusGeometry(0.0046, 0.00028, 6, 40), M.black, 0.044, y0 + 0.0592, 0.03, true);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        group.userData.knobs = knobs;
        group.userData.bubble = bubble;
        group.userData.vial = V3(0.044, y0 + 0.0587, 0.03);
        // 光學對點器 (optical plummet)
        const op = rodBetween(V3(0, y0 + 0.045, -0.03), V3(0, y0 + 0.045, -0.075), 0.007, 0.009, M.black, 12);
        group.add(op);
        // 鎖定扳手
        group.add(boxBetween(V3(-0.05, y0 + 0.044, 0.02), V3(-0.07, y0 + 0.044, 0.035), 0.01, 0.006, M.black));
        return y0 + 0.062;
    }

    // ------------------------------------------------------------------
    // GNSS 接收儀 + 控制手簿
    // ------------------------------------------------------------------
    function controllerScreenTex() {
        return canvasTex(128, 224, (c, w, h) => {
            c.fillStyle = '#0b1220'; c.fillRect(0, 0, w, h);
            c.fillStyle = '#1e3a5f'; c.fillRect(0, 0, w, 18);
            c.fillStyle = '#e2e8f0'; c.font = 'bold 11px sans-serif'; c.fillText('GNSS  Static', 6, 13);
            c.fillStyle = '#10b981'; c.fillText('● REC', 84, 13);
            // Skyplot
            c.strokeStyle = '#3b82f6'; c.lineWidth = 1;
            [44, 30, 15].forEach(r => { c.beginPath(); c.arc(64, 78, r, 0, Math.PI * 2); c.stroke(); });
            c.beginPath(); c.moveTo(20, 78); c.lineTo(108, 78); c.moveTo(64, 34); c.lineTo(64, 122); c.stroke();
            const sats = [[50, 60, '#22c55e'], [80, 50, '#22c55e'], [90, 95, '#eab308'], [40, 100, '#22c55e'], [70, 110, '#38bdf8'], [60, 70, '#22c55e'], [30, 72, '#38bdf8']];
            sats.forEach(([x, y, cl]) => { c.fillStyle = cl; c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill(); });
            c.fillStyle = '#94a3b8'; c.font = '10px monospace';
            ['SV  : 18', 'PDOP: 1.4', 'EPOCH 0612', 'H 1.523 m'].forEach((t, i) => c.fillText(t, 8, 146 + i * 16));
            c.fillStyle = '#22c55e'; c.fillRect(8, 206, 80 * 0.62, 6);
            c.strokeStyle = '#334155'; c.strokeRect(8, 206, 80, 6);
        });
    }

    function buildGNSSHead(head) {
        // 天線連接座 (antenna adapter / carrier)
        head.add(mk(lathe([[0, 0], [0.034, 0], [0.034, 0.012], [0.024, 0.016], [0.022, 0.05], [0, 0.05]], 24), M.greyPlastic));
        head.add(mk(new THREE.CylinderGeometry(0.01, 0.01, 0.02, 10), M.brass, 0, 0.058, 0));
        const y = 0.062;
        // 接收儀下殼
        head.add(mk(lathe([[0, 0], [0.055, 0], [0.086, 0.01], [0.094, 0.028], [0.095, 0.05], [0, 0.05]], 40), M.darkGrey, 0, y, 0));
        // 防撞橡膠圈 + 狀態 LED 環
        const bumper = mk(new THREE.TorusGeometry(0.096, 0.0085, 10, 48), M.rubber, 0, y + 0.05, 0);
        bumper.rotation.x = Math.PI / 2;
        head.add(bumper);
        const led = mk(new THREE.TorusGeometry(0.0955, 0.0028, 6, 48), M.ledGreen, 0, y + 0.039, 0, true);
        led.rotation.x = Math.PI / 2;
        head.add(led);
        // 天線罩 (radome)
        head.add(mk(lathe([[0.094, 0], [0.093, 0.012], [0.086, 0.028], [0.068, 0.046], [0.038, 0.057], [0, 0.06]], 40), M.white, 0, y + 0.052, 0));
        // 前面板 + LED 指示燈 + 電源鍵
        const panel = mk(rbox(0.058, 0.022, 0.012, 0.004), M.black, 0, y + 0.024, 0.088);
        panel.rotation.x = -0.25;
        head.add(panel);
        [M.ledGreen, M.ledAmber, M.ledGreen].forEach((m, i) => head.add(mk(new THREE.SphereGeometry(0.0028, 8, 6), m, -0.016 + i * 0.011, y + 0.026, 0.0955, true)));
        head.add(mk(new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 12), M.red, 0.02, y + 0.024, 0.095, true).rotateX(Math.PI / 2 - 0.25));
        // 量高缺口 (HI measure mark)
        head.add(mk(new THREE.BoxGeometry(0.016, 0.005, 0.01), M.yellow, -0.1, y + 0.05, 0, true));
        head.userData.hiMark = V3(-0.1085, y + 0.05, 0);
        // 側邊 UHF 天線接頭
        head.add(rodBetween(V3(0.08, y + 0.02, -0.04), V3(0.105, y + 0.02, -0.05), 0.006, 0.006, M.brass, 8));
    }

    function attachController(group, leg) {
        const p = leg.P(0.42);
        // 夾具
        const clamp = mk(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16), M.black);
        clamp.position.copy(p);
        clamp.quaternion.setFromUnitVectors(UP, leg.u);
        group.add(clamp);
        const armEnd = p.clone().addScaledVector(leg.out, 0.07).add(V3(0, 0.03, 0));
        group.add(rodBetween(p, armEnd, 0.006, 0.006, M.aluDark, 8));
        // 手簿本體
        const ctrl = new THREE.Group();
        ctrl.add(mk(rbox(0.09, 0.165, 0.026, 0.008), M.darkGrey));
        const screen = mk(new THREE.PlaneGeometry(0.07, 0.12), new THREE.MeshBasicMaterial({ map: controllerScreenTex() }), 0, 0.012, 0.0135, true);
        ctrl.add(screen);
        group.userData.ctrlScreen = screen;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
            ctrl.add(mk(new THREE.BoxGeometry(0.013, 0.008, 0.003), M.greyPlastic, -0.0255 + c * 0.017, -0.06 + r * 0.011, 0.0135, true));
        }
        ctrl.position.copy(armEnd).addScaledVector(leg.out, 0.02);
        ctrl.rotation.order = 'YXZ';
        ctrl.rotation.y = Math.atan2(leg.out.x, leg.out.z);
        ctrl.rotation.x = -0.55;
        group.add(ctrl);
    }

    // ------------------------------------------------------------------
    // 自動水準儀 (Auto level) — 鏡頭朝 +Z
    // ------------------------------------------------------------------
    function buildLevelHead(head) {
        head.add(mk(lathe([[0, 0], [0.058, 0], [0.06, 0.008], [0.056, 0.03], [0.045, 0.034], [0, 0.034]], 32), M.darkGrey));
        // 無限微動螺旋 (endless horizontal drive) 兩側
        [-1, 1].forEach(s => {
            const k = mk(new THREE.CylinderGeometry(0.011, 0.011, 0.016, 16), M.black, s * 0.064, 0.02, 0.018);
            k.rotation.z = Math.PI / 2;
            head.add(k);
        });
        // 本體
        head.add(mk(rbox(0.088, 0.07, 0.15, 0.014), M.cream, 0, 0.07, 0));
        [-1, 1].forEach(s => head.add(mk(rbox(0.004, 0.04, 0.11, 0.0018), M.blue, s * 0.0448, 0.066, 0.0, true)));
        // 物鏡筒 + 遮光罩
        head.add(rodBetween(V3(0, 0.074, 0.06), V3(0, 0.074, 0.122), 0.031, 0.036, M.cream, 28));
        head.add(rodBetween(V3(0, 0.074, 0.12), V3(0, 0.074, 0.127), 0.037, 0.037, M.black, 28));
        head.add(mk(new THREE.CircleGeometry(0.029, 28), M.lens, 0, 0.074, 0.124, true));
        // 目鏡 (rubber eyepiece)
        head.add(rodBetween(V3(0, 0.074, -0.074), V3(0, 0.074, -0.098), 0.02, 0.018, M.black, 20));
        head.add(rodBetween(V3(0, 0.074, -0.098), V3(0, 0.074, -0.122), 0.018, 0.022, M.rubber, 20));
        // 調焦螺旋
        const fk = mk(new THREE.CylinderGeometry(0.017, 0.017, 0.024, 20), M.black, 0.056, 0.078, 0.02);
        fk.rotation.z = Math.PI / 2;
        head.add(fk);
        // 圓氣泡觀察稜鏡
        head.add(mk(rbox(0.022, 0.026, 0.024, 0.004), M.cream, -0.055, 0.075, -0.03));
        head.add(mk(new THREE.PlaneGeometry(0.014, 0.014), M.glass, -0.0555, 0.078, -0.0175, true));
        // 照準器 (peep sight)
        head.add(mk(new THREE.BoxGeometry(0.01, 0.01, 0.07), M.black, 0, 0.11, 0.0));
        const sight = mk(new THREE.ConeGeometry(0.006, 0.012, 3), M.black, 0, 0.12, 0.03);
        head.add(sight);
        // 刻度盤
        head.add(mk(new THREE.CylinderGeometry(0.059, 0.059, 0.006, 40), M.white, 0, 0.031, 0));
    }

    // ------------------------------------------------------------------
    // 全站儀 (Total station) — 望遠鏡朝 +Z
    // ------------------------------------------------------------------
    function tsScreenTex() {
        return canvasTex(256, 128, (c, w, h) => {
            c.fillStyle = '#c8d6c0'; c.fillRect(0, 0, w, h);
            c.fillStyle = '#1f2a1c'; c.font = 'bold 20px monospace';
            c.fillText('HA  123°45\'20"', 10, 30);
            c.fillText('VA   89°58\'40"', 10, 58);
            c.fillText('SD   48.276 m', 10, 86);
            c.fillStyle = '#334155'; c.fillRect(0, 100, w, 28);
            c.fillStyle = '#e2e8f0'; c.font = 'bold 15px sans-serif';
            ['MEAS', 'TARG', 'DISP', 'P1↓'].forEach((t, i) => c.fillText(t, 8 + i * 62, 120));
        });
    }
    function buildTotalStationHead(head) {
        head.add(mk(lathe([[0, 0], [0.066, 0], [0.068, 0.006], [0.064, 0.022], [0, 0.022]], 32), M.darkGrey));
        // 下部儀器座
        head.add(mk(rbox(0.17, 0.075, 0.15, 0.014), M.cream, 0, 0.06, 0));
        // 雙面顯示器 + 鍵盤
        const scrTex = tsScreenTex();
        [1, -1].forEach(side => {
            const g = new THREE.Group();
            g.add(mk(rbox(0.135, 0.06, 0.012, 0.004), M.darkGrey));
            g.add(mk(new THREE.PlaneGeometry(0.06, 0.03), new THREE.MeshBasicMaterial({ map: scrTex }), -0.03, 0.006, 0.0065, true));
            for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
                g.add(mk(new THREE.BoxGeometry(0.009, 0.0075, 0.003), (r === 0 && c === 3) ? M.blue : M.greyPlastic, 0.012 + c * 0.0125, 0.014 - r * 0.012, 0.0065, true));
            }
            g.position.set(0, 0.058, side * 0.081);
            g.rotation.y = side > 0 ? 0 : Math.PI;
            g.rotation.x = side > 0 ? -0.18 : 0.18;
            if (side < 0) g.rotation.x = -0.18;
            head.add(g);
        });
        // 支架 (standards) + 黃色側蓋
        [-1, 1].forEach(s => {
            head.add(mk(rbox(0.034, 0.15, 0.1, 0.01), M.cream, s * 0.068, 0.17, 0));
            head.add(mk(rbox(0.004, 0.11, 0.072, 0.0018), M.yellow, s * 0.0855, 0.17, 0, true));
            // 微動螺旋
            const k = mk(new THREE.CylinderGeometry(0.013, 0.013, 0.02, 18), M.black, s * 0.095, 0.14, 0.025);
            k.rotation.z = Math.PI / 2;
            head.add(k);
        });
        const hk = mk(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 18), M.black, 0.07, 0.048, -0.085);
        hk.rotation.x = Math.PI / 2;
        head.add(hk);
        // 提把 (carry handle)
        [-1, 1].forEach(s => head.add(mk(new THREE.BoxGeometry(0.02, 0.032, 0.03), M.black, s * 0.068, 0.258, 0)));
        head.add(mk(rbox(0.17, 0.018, 0.034, 0.007), M.black, 0, 0.278, 0));

        // 望遠鏡 (可俯仰的 telescope group) — 橫軸高 0.185
        const scope = new THREE.Group();
        scope.position.set(0, 0.185, 0);
        scope.add(rodBetween(V3(-0.052, 0, 0), V3(0.052, 0, 0), 0.02, 0.02, M.darkGrey, 18));
        scope.add(mk(rbox(0.07, 0.07, 0.15, 0.016), M.darkGrey, 0, 0, 0.005));
        scope.add(rodBetween(V3(0, 0, 0.075), V3(0, 0, 0.11), 0.038, 0.042, M.cream, 30));
        scope.add(mk(new THREE.CircleGeometry(0.035, 30), M.lens, 0, 0, 0.108, true));
        scope.add(mk(new THREE.SphereGeometry(0.004, 8, 6), M.ledRed, 0, 0, 0.11, true));
        scope.add(rodBetween(V3(0, 0, -0.07), V3(0, 0, -0.1), 0.02, 0.017, M.black, 18));
        scope.add(rodBetween(V3(0, 0, -0.1), V3(0, 0, -0.118), 0.017, 0.021, M.rubber, 18));
        scope.add(mk(new THREE.BoxGeometry(0.012, 0.012, 0.06), M.black, 0, 0.042, 0.01));
        head.add(scope);
        head.userData.scope = scope;
    }

    /**
     * 完整儀器組：三腳架 + 基座 + 儀器頭
     * 回傳 { group, head } ; head 可 rotation.y 轉向目標 (+Z 為照準方向)
     */
    function buildInstrumentStation(type) {
        const group = new THREE.Group();
        const legs = buildTripod(group, 1.28);
        const tribrach = new THREE.Group();
        group.add(tribrach);
        const top = buildTribrach(tribrach, 1.28);
        const head = new THREE.Group();
        head.position.y = top;
        group.add(head);
        const accessories = new THREE.Group();
        group.add(accessories);
        if (type === 'gnss') {
            buildGNSSHead(head);
            attachController(accessories, legs[1]);
        } else if (type === 'level') {
            buildLevelHead(head);
        } else if (type === 'totalstation') {
            buildTotalStationHead(head);
        }
        return { group, head, tribrach, accessories };
    }

    // ==================================================================
    // 水準標尺 (Level staff) — 正反面 (±Z) 為 E 字刻劃
    // ==================================================================
    function decorateLevelStaff(group, height) {
        // 鋁合金側框
        [-1, 1].forEach(s => group.add(mk(new THREE.BoxGeometry(0.006, height, 0.046), M.alu, s * 0.053, height / 2, 0)));
        // 伸縮段接頭與鎖扣
        [height * 0.4, height * 0.74].forEach(y => {
            group.add(mk(new THREE.BoxGeometry(0.114, 0.03, 0.05), M.aluDark, 0, y, 0));
            [-1, 1].forEach(s => group.add(mk(new THREE.BoxGeometry(0.012, 0.05, 0.03), M.black, s * 0.062, y + 0.03, 0)));
        });
        // 底座鋼板 + 頂蓋
        group.add(mk(new THREE.BoxGeometry(0.112, 0.014, 0.052), M.steel, 0, 0.007, 0));
        group.add(mk(rbox(0.112, 0.024, 0.052, 0.006), M.black, 0, height + 0.012, 0));
        // 標尺圓水準器 (rod bubble) + 握把
        const bub = new THREE.Group();
        bub.add(mk(new THREE.BoxGeometry(0.03, 0.05, 0.004), M.aluDark, 0, 0, 0));
        bub.add(mk(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 18), M.black, 0.02, 0.012, 0));
        bub.add(mk(new THREE.CylinderGeometry(0.012, 0.012, 0.002, 18), M.glass, 0.02, 0.0195, 0, true));
        bub.add(mk(new THREE.SphereGeometry(0.004, 8, 6), M.bubble, 0.021, 0.02, 0.001, true));
        bub.position.set(0.07, 1.45, 0);
        group.add(bub);
        group.add(mk(rbox(0.024, 0.12, 0.026, 0.008), M.black, -0.07, 1.25, 0));
    }

    // ==================================================================
    // 稜鏡桿 (Prism pole) — 稜鏡朝 +Z
    // ==================================================================
    let _poleTex = null;
    function buildPrismPole(group, h = 1.8) {
        if (!_poleTex) {
            _poleTex = canvasTex(8, 64, (c) => {
                c.fillStyle = '#d62828'; c.fillRect(0, 0, 8, 32);
                c.fillStyle = '#f5f5f5'; c.fillRect(0, 32, 8, 32);
            }, { repeat: [1, 9] });
        }
        const poleMat = new THREE.MeshStandardMaterial({ map: _poleTex, roughness: 0.4, metalness: 0.2 });
        group.add(mk(new THREE.CylinderGeometry(0.0125, 0.0125, h - 0.12, 14), poleMat, 0, 0.06 + (h - 0.12) / 2, 0));
        group.add(mk(new THREE.ConeGeometry(0.0125, 0.06, 12).rotateX(Math.PI), M.steel, 0, 0.03, 0));
        group.add(mk(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 14), M.black, 0, 0.75, 0));
        // 桿式圓水準器
        const b = new THREE.Group();
        b.add(mk(new THREE.BoxGeometry(0.03, 0.04, 0.03), M.black, 0.025, 0, 0));
        b.add(mk(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 18), M.black, 0.045, 0.02, 0));
        b.add(mk(new THREE.CylinderGeometry(0.012, 0.012, 0.002, 18), M.glass, 0.045, 0.0275, 0, true));
        b.add(mk(new THREE.SphereGeometry(0.0035, 8, 6), M.bubble, 0.046, 0.028, 0, true));
        b.position.y = 1.35;
        group.add(b);
        // 稜鏡支架 + 稜鏡筒
        const top = new THREE.Group();
        top.position.y = h;
        top.add(mk(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 12), M.black, 0, -0.06, 0));
        top.add(mk(new THREE.BoxGeometry(0.12, 0.012, 0.018), M.black, 0, -0.04, 0));
        [-1, 1].forEach(s => {
            top.add(mk(new THREE.BoxGeometry(0.012, 0.06, 0.018), M.black, s * 0.054, -0.01, 0));
            const knob = mk(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10), M.black, s * 0.064, 0, 0);
            knob.rotation.z = Math.PI / 2;
            top.add(knob);
        });
        top.add(rodBetween(V3(0, 0, -0.02), V3(0, 0, 0.03), 0.044, 0.044, M.orange, 28));
        top.add(rodBetween(V3(0, 0, 0.03), V3(0, 0, 0.034), 0.044, 0.046, M.black, 28));
        const glass = mk(new THREE.CylinderGeometry(0.0, 0.037, 0.012, 6, 1), M.lens, 0, 0, 0.026, true);
        glass.rotation.x = -Math.PI / 2;
        top.add(glass);
        // 覘標板 (target plate)
        const plateTex = canvasTex(128, 96, (c, w, h2) => {
            c.fillStyle = '#facc15'; c.fillRect(0, 0, w, h2);
            c.fillStyle = '#111';
            c.beginPath(); c.moveTo(0, 0); c.lineTo(w / 2, h2 / 2); c.lineTo(0, h2); c.fill();
            c.beginPath(); c.moveTo(w, 0); c.lineTo(w / 2, h2 / 2); c.lineTo(w, h2); c.fill();
        });
        const tp = mk(new THREE.BoxGeometry(0.14, 0.1, 0.006), [M.black, M.black, M.black, M.black, new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6 })], 0, 0.1, 0.0);
        top.add(tp);
        top.add(mk(new THREE.BoxGeometry(0.012, 0.05, 0.012), M.black, 0, 0.045, 0));
        group.add(top);
    }

    // ==================================================================
    // 控制點樁 (Survey monument)
    // ==================================================================
    let _concreteTex = null;
    function concreteTex() {
        if (_concreteTex) return _concreteTex;
        _concreteTex = canvasTex(256, 256, (c, w, h) => {
            c.fillStyle = '#8f8b82'; c.fillRect(0, 0, w, h);
            const r = rng(77);
            for (let i = 0; i < 4000; i++) {
                const v = 115 + Math.floor(r() * 55);
                c.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.25 + r() * 0.3})`;
                c.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
            }
            for (let i = 0; i < 60; i++) {
                c.fillStyle = `rgba(60,60,55,${0.15 + r() * 0.25})`;
                c.beginPath(); c.arc(r() * w, r() * h, 0.8 + r() * 1.8, 0, Math.PI * 2); c.fill();
            }
            const g = c.createLinearGradient(0, h * 0.6, 0, h);
            g.addColorStop(0, 'rgba(70,60,40,0)'); g.addColorStop(1, 'rgba(70,60,40,0.35)');
            c.fillStyle = g; c.fillRect(0, 0, w, h);
        });
        return _concreteTex;
    }

    function buildMonument(group, labelText) {
        const conc = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.92, color: 0xc4beb2 });
        // 混凝土護底
        group.add(mk(rbox(0.62, 0.07, 0.62, 0.02), conc, 0, 0.02, 0));
        // 錐形方樁 (tapered square pillar)
        const pillarGeo = new THREE.CylinderGeometry(0.142, 0.17, 0.22, 4, 1);
        pillarGeo.rotateY(Math.PI / 4);
        group.add(mk(pillarGeo, conc, 0, 0.055 + 0.11, 0));
        // 頂面紅漆 + 銅質標盤
        group.add(mk(new THREE.BoxGeometry(0.2, 0.004, 0.2), std('monRed', { color: 0xb91c1c, roughness: 0.7 }), 0, 0.267, 0, true));
        const short = labelText.split(' ')[0];
        const isBM = /BM/.test(short);
        const discTex = canvasTex(128, 128, (c, w, h) => {
            const g = c.createRadialGradient(54, 50, 6, 64, 64, 64);
            g.addColorStop(0, '#f2d27a'); g.addColorStop(1, '#a87b22');
            c.fillStyle = g; c.fillRect(0, 0, w, h);
            c.strokeStyle = '#5c3d0a'; c.lineWidth = 3;
            c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.stroke();
            c.beginPath(); c.arc(64, 64, 40, 0, Math.PI * 2); c.stroke();
            c.lineWidth = 2.5;
            c.beginPath(); c.moveTo(64, 46); c.lineTo(64, 82); c.moveTo(46, 64); c.lineTo(82, 64); c.stroke();
            c.fillStyle = '#5c3d0a'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center';
            c.fillText(isBM ? '水準點' : '衛星控制點', 64, 22);
            c.fillText(short, 64, 116);
        });
        const disc = mk(new THREE.CylinderGeometry(0.05, 0.052, 0.012, 32),
            [new THREE.MeshStandardMaterial({ color: 0xb38a35, roughness: 0.3, metalness: 0.9 }),
             new THREE.MeshStandardMaterial({ map: discTex, roughness: 0.35, metalness: 0.75 }),
             M.brass], 0, 0.274, 0);
        group.add(disc);
        // 側面刻字 (engraved plate)
        const sideTex = canvasTex(256, 192, (c, w, h) => {
            c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, w, h);
            c.fillStyle = 'rgba(40,38,34,0.85)';
            c.font = 'bold 40px "Microsoft JhengHei", "Noto Sans TC", sans-serif';
            c.textAlign = 'center';
            c.fillText(isBM ? '水 準 點' : '衛星控制點', w / 2, 60);
            c.font = 'bold 34px monospace';
            c.fillText(short, w / 2, 112);
            c.font = '24px sans-serif';
            c.fillText('內政部', w / 2, 160);
        });
        const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
        const tilt = Math.atan((0.17 - 0.142) / Math.SQRT2 / 0.22);
        for (let i = 0; i < 2; i++) {
            const pl = mk(new THREE.PlaneGeometry(0.19, 0.14), sideMat, 0, 0.165, 0, true);
            const a = i * Math.PI;
            const off = (0.142 + 0.17) / 2 / Math.SQRT2 + 0.0015;
            pl.position.set(Math.sin(a) * off, 0.165, Math.cos(a) * off);
            pl.rotation.order = 'YXZ';
            pl.rotation.y = a;
            pl.rotation.x = -tilt;
            pl.receiveShadow = true; pl.castShadow = false;
            group.add(pl);
        }
    }

    // ==================================================================
    // 無人機 (RTK 測繪無人機) — 機頭朝 -Z
    // ==================================================================
    function bladeGeo() {
        const s = new THREE.Shape();
        s.moveTo(0.012, -0.008);
        s.bezierCurveTo(0.06, -0.019, 0.14, -0.016, 0.205, -0.006);
        s.quadraticCurveTo(0.215, 0, 0.205, 0.006);
        s.bezierCurveTo(0.14, 0.011, 0.06, 0.012, 0.012, 0.008);
        s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false, curveSegments: 8 });
        g.rotateX(-Math.PI / 2);
        // twist (pitch angle) toward the tip
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const tw = 0.32 - x * 1.0;
            p.setY(i, y + z * Math.sin(tw));
            p.setZ(i, z * Math.cos(tw));
        }
        g.computeVertexNormals();
        return g;
    }

    function buildDrone() {
        const root = new THREE.Group();
        const g = new THREE.Group();
        g.position.y = -0.2; // 讓腳架底部 ≈ -0.42 (著地)
        root.add(g);
        const propellers = [];

        const bodyMat = std('droneBody', { color: 0x2f343c, roughness: 0.42, metalness: 0.15 });
        const shellMat = std('droneShell', { color: 0x474d57, roughness: 0.35, metalness: 0.2 });

        // 機身
        g.add(mk(rbox(0.25, 0.085, 0.36, 0.03), bodyMat));
        g.add(mk(rbox(0.21, 0.04, 0.3, 0.018), shellMat, 0, 0.05, 0.01));
        // 散熱格柵
        for (let i = 0; i < 5; i++) g.add(mk(new THREE.BoxGeometry(0.12, 0.003, 0.006), M.black, 0, 0.071, 0.06 + i * 0.016, true));
        // 前方視覺感測器
        [-1, 1].forEach(s => {
            g.add(mk(rbox(0.035, 0.022, 0.01, 0.004), M.glass, s * 0.05, 0.005, -0.181, true));
            g.add(mk(rbox(0.03, 0.018, 0.01, 0.004), M.glass, s * 0.126, 0.005, -0.06, true).rotateY(Math.PI / 2));
        });
        // 黃色識別飾條
        g.add(mk(new THREE.BoxGeometry(0.252, 0.008, 0.02), M.yellow, 0, 0.02, -0.15, true));
        // 智慧電池 (雙電池)
        [-1, 1].forEach(s => {
            g.add(mk(rbox(0.07, 0.05, 0.12, 0.01), std('droneBatt', { color: 0x5a616c, roughness: 0.5 }), s * 0.045, 0.085, -0.07));
            for (let k = 0; k < 4; k++) g.add(mk(new THREE.BoxGeometry(0.006, 0.003, 0.006), k < 3 ? M.ledGreen : M.black, s * 0.045 - 0.015 + k * 0.01, 0.111, -0.115, true));
        });
        // RTK 模組 + 雙天線桿
        g.add(mk(rbox(0.09, 0.025, 0.07, 0.008), bodyMat, 0, 0.083, 0.08));
        [-1, 1].forEach(s => {
            g.add(rodBetween(V3(s * 0.035, 0.09, 0.08), V3(s * 0.035, 0.17, 0.08), 0.005, 0.004, M.carbon, 8));
            g.add(mk(lathe([[0, 0], [0.024, 0], [0.024, 0.008], [0.016, 0.016], [0, 0.018]], 20), M.white, s * 0.035, 0.17, 0.08));
        });
        g.add(mk(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 16), M.yellow, 0, 0.098, 0.08, true));

        // 機臂 + 馬達 + 螺旋槳
        const armR = 0.42;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], idx) => {
            const ang = Math.atan2(sz, sx);
            const root2 = V3(Math.cos(ang) * 0.14, 0.01, Math.sin(ang) * 0.14);
            const tip = V3(Math.cos(ang) * armR, 0.035, Math.sin(ang) * armR);
            // 折疊關節
            const hinge = mk(rbox(0.05, 0.04, 0.05, 0.008), bodyMat, root2.x, root2.y, root2.z);
            hinge.rotation.y = -ang;
            g.add(hinge);
            g.add(rodBetween(root2, tip, 0.017, 0.013, M.carbon, 14));
            // 馬達
            g.add(mk(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20), bodyMat, tip.x, tip.y, tip.z));
            g.add(mk(lathe([[0.036, 0], [0.037, 0.03], [0.03, 0.038], [0.008, 0.04], [0, 0.04]], 24), M.aluDark, tip.x, tip.y + 0.008, tip.z));
            g.add(mk(new THREE.CylinderGeometry(0.0375, 0.0375, 0.006, 24), M.black, tip.x, tip.y + 0.02, tip.z));
            // 航行燈 (前紅後綠)
            g.add(mk(new THREE.SphereGeometry(0.008, 10, 8), sz < 0 ? M.ledRed : M.ledGreen, tip.x, tip.y - 0.016, tip.z, true));
            // 螺旋槳
            const prop = new THREE.Group();
            prop.position.set(tip.x, tip.y + 0.052, tip.z);
            const dirSign = (idx % 2 === 0) ? 1 : -1;
            const bg = bladeGeo();
            [0, Math.PI].forEach(r => {
                const b = mk(bg, M.black, 0, 0, 0);
                b.rotation.y = r;
                if (dirSign < 0) b.scale.z = -1;
                prop.add(b);
            });
            prop.add(mk(new THREE.CylinderGeometry(0.014, 0.018, 0.012, 16), M.aluDark, 0, 0.002, 0));
            const disc = new THREE.Mesh(new THREE.CircleGeometry(0.21, 40).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
            disc.position.y = 0.002;
            prop.add(disc);
            prop.userData.disc = disc;
            prop.rotation.y = idx * 0.7;
            g.add(prop);
            propellers.push(prop);
        });

        // 起落架 (landing gear)
        [-1, 1].forEach(s => {
            [-1, 1].forEach(f => {
                g.add(rodBetween(V3(s * 0.08, -0.035, f * 0.08), V3(s * 0.15, -0.22, f * 0.11), 0.007, 0.007, M.carbon, 8));
            });
            const skid = rodBetween(V3(s * 0.15, -0.22, -0.16), V3(s * 0.15, -0.22, 0.16), 0.009, 0.009, M.carbon, 10);
            g.add(skid);
            [-0.16, 0.16].forEach(z => g.add(mk(new THREE.SphereGeometry(0.011, 10, 8), M.rubber, s * 0.15, -0.22, z)));
        });

        // 雲台相機 (3-axis gimbal + mapping camera)
        g.add(mk(new THREE.BoxGeometry(0.08, 0.008, 0.06), bodyMat, 0, -0.047, -0.12));
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => g.add(mk(new THREE.SphereGeometry(0.007, 8, 6), M.black, a * 0.03, -0.055, -0.12 + b * 0.02)));
        const yaw = new THREE.Group();
        yaw.position.set(0, -0.065, -0.12);
        yaw.add(mk(new THREE.CylinderGeometry(0.014, 0.014, 0.014, 14), M.black, 0, 0, 0));
        yaw.add(mk(new THREE.BoxGeometry(0.012, 0.055, 0.02), M.darkGrey, 0.048, -0.03, 0));
        yaw.add(mk(new THREE.BoxGeometry(0.06, 0.01, 0.02), M.darkGrey, 0.02, -0.004, 0));
        const tilt = new THREE.Group();
        tilt.position.set(0, -0.045, 0);
        tilt.add(mk(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16).rotateZ(Math.PI / 2), M.black, 0.04, 0, 0));
        tilt.add(mk(rbox(0.07, 0.058, 0.07, 0.01), M.darkGrey, 0, 0, 0));
        tilt.add(rodBetween(V3(0, 0, -0.035), V3(0, 0, -0.06), 0.022, 0.024, M.black, 24));
        tilt.add(mk(new THREE.CircleGeometry(0.019, 24).rotateY(Math.PI), M.lens, 0, 0, -0.0605, true));
        tilt.add(mk(new THREE.BoxGeometry(0.02, 0.006, 0.005), M.black, 0.02, 0.022, -0.036, true));
        yaw.add(tilt);
        g.add(yaw);

        // 頂部閃光燈
        g.add(mk(new THREE.SphereGeometry(0.007, 8, 6), M.ledWhite, 0, 0.074, 0.15, true));

        root.userData.gimbalTilt = tilt;
        return { group: root, propellers };
    }

    // ==================================================================
    // 環境物件
    // ==================================================================
    function coniferParts(r, s = 1, parts = [], m = null) {
        const H = (5.5 + r() * 3.5) * s;
        const trunkC = colVar(0x5b4130, r, 0.2);
        const tg = new THREE.CylinderGeometry(0.1 * s, 0.24 * s, H * 0.5, 7);
        tg.translate(0, H * 0.25, 0);
        parts.push({ geo: tg, color: trunkC, matrix: m });
        const n = 4 + Math.floor(r() * 2);
        const baseG = colVar(0x2f5d34, r, 0.25);
        for (let k = 0; k < n; k++) {
            const t = k / n;
            const rad = (1.9 - 1.35 * t) * s * (0.9 + r() * 0.2);
            const hh = H * 0.34;
            const y = H * 0.24 + t * H * 0.62;
            const cg = new THREE.ConeGeometry(rad, hh, 9, 2);
            cg.translate(0, y + hh / 2, 0);
            cg.rotateY(r() * 6);
            jitter(cg, 0.28 * s, k + r() * 10);
            const c = baseG.clone().offsetHSL(0, 0, t * 0.06 - 0.02);
            parts.push({ geo: cg, color: c, matrix: m });
        }
        return H;
    }
    function broadleafParts(r, s = 1, parts = [], m = null) {
        const trunkC = colVar(0x6b4b35, r, 0.2);
        const th = (2.2 + r() * 0.8) * s;
        const tg = new THREE.CylinderGeometry(0.15 * s, 0.3 * s, th, 8);
        tg.translate(0, th / 2, 0);
        parts.push({ geo: tg, color: trunkC, matrix: m });
        const crownY = th + 1.3 * s;
        const nb = 3;
        for (let i = 0; i < nb; i++) {
            const a = i * Math.PI * 2 / nb + r();
            const from = V3(0, th * 0.8, 0), to = V3(Math.cos(a) * 1.1 * s, crownY, Math.sin(a) * 1.1 * s);
            const d = new THREE.Vector3().subVectors(to, from);
            const bg = new THREE.CylinderGeometry(0.06 * s, 0.11 * s, d.length(), 6);
            bg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize())));
            bg.translate(from.x + d.x / 2, from.y + d.y / 2, from.z + d.z / 2);
            parts.push({ geo: bg, color: trunkC, matrix: m });
        }
        const base = colVar(0x3f7a35, r, 0.3);
        const blobs = 7 + Math.floor(r() * 4);
        for (let i = 0; i < blobs; i++) {
            const a = r() * Math.PI * 2, rr = r() * 1.5 * s;
            const rad = (1.0 + r() * 0.8) * s;
            const ig = new THREE.IcosahedronGeometry(rad, 1);
            ig.scale(1, 0.82, 1);
            jitter(ig, 0.35 * s, i * 3.3 + r() * 9);
            ig.translate(Math.cos(a) * rr, crownY + 0.6 * s + (r() - 0.3) * 1.3 * s, Math.sin(a) * rr);
            parts.push({ geo: ig, color: base.clone().offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.08), matrix: m });
        }
        return crownY + 2;
    }
    function palmParts(r, s, trunkParts, frondParts) {
        const H = (6.5 + r() * 2.5) * s;
        const lean = (r() - 0.5) * 0.12;
        const segs = 10;
        for (let i = 0; i < segs; i++) {
            const y0 = i * H / segs, y1 = (i + 1) * H / segs;
            const g = new THREE.CylinderGeometry(0.1, 0.11, y1 - y0, 8);
            g.translate(lean * (y0 + y1) / 2, (y0 + y1) / 2, 0);
            trunkParts.push({ geo: g, color: (i % 2) ? col(0x8d8a80) : col(0x7a776d) });
        }
        const sh = new THREE.CylinderGeometry(0.11, 0.12, 0.9, 8);
        sh.translate(lean * H, H + 0.45, 0);
        trunkParts.push({ geo: sh, color: col(0x6f8f3a) });
        const top = V3(lean * H, H + 0.85, 0);
        const fronds = 9;
        for (let k = 0; k < fronds; k++) {
            const L = 2.4 + r() * 0.5, W = 0.55;
            const phi = 0.55 + r() * 0.7;
            const droop = 0.9 + r() * 0.5;
            const g = new THREE.PlaneGeometry(W, L, 2, 8);
            const p = g.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const x = p.getX(i), y = p.getY(i) + L / 2;
                const t = y / L;
                const w = x * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08));
                const d = Math.sin(phi) * y;
                const hgt = Math.cos(phi) * y - droop * t * t;
                p.setXYZ(i, w, hgt - Math.abs(w) * 0.25, d);
            }
            g.rotateY(k * Math.PI * 2 / fronds + r() * 0.3);
            g.translate(top.x, top.y, top.z);
            g.computeVertexNormals();
            frondParts.push({ geo: g, color: colVar(0x5d8f2f, r, 0.25) });
        }
    }

    function rockGeo(r, s) {
        const g = r() > 0.5 ? new THREE.DodecahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, 1);
        g.scale(s * (0.8 + r() * 0.6), s * (0.45 + r() * 0.3), s * (0.8 + r() * 0.6));
        jitter(g, s * 0.35, r() * 100);
        g.rotateY(r() * 6);
        return g;
    }

    // ---------------- 測量作業車 (survey pickup) ----------------
    function buildSurveyTruck() {
        const g = new THREE.Group();
        const W = 1.82;
        const s = new THREE.Shape();
        s.moveTo(-2.62, 0.48);
        s.lineTo(-2.62, 1.02);
        s.lineTo(-0.72, 1.04);
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
        const bev = 0.05;
        const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: W - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 16 });
        bodyGeo.translate(0, 0, -(W - bev * 2) / 2);
        g.add(mk(bodyGeo, M.carPaint));
        // 車窗 (側窗 + 擋風玻璃 + 後窗)
        const ws = new THREE.Shape();
        ws.moveTo(-0.6, 1.2); ws.lineTo(-0.56, 1.7); ws.lineTo(0.5, 1.72); ws.quadraticCurveTo(0.66, 1.7, 1.0, 1.2); ws.lineTo(-0.6, 1.2);
        const wg = new THREE.ExtrudeGeometry(ws, { depth: W + 0.012, bevelEnabled: false });
        wg.translate(0, 0, -(W + 0.012) / 2);
        g.add(mk(wg, M.glass, 0, 0, 0, true));
        const bpillar = mk(new THREE.BoxGeometry(0.07, 0.5, W + 0.02), M.carPaint, 0.18, 1.45, 0, true);
        g.add(bpillar);
        const wsGeo = new THREE.PlaneGeometry(0.74, W - 0.2).rotateX(-Math.PI / 2).rotateZ(-Math.atan2(0.52, 0.5));
        const wsN = V3(0.52, 0.5, 0).normalize();
        const windshield = mk(wsGeo, M.glass, 0.76 + wsN.x * 0.055, 1.46 + wsN.y * 0.055, 0, true);
        g.add(windshield);
        const rear = mk(new THREE.PlaneGeometry(W - 0.3, 0.42), M.glass, -0.745, 1.47, 0, true);
        rear.rotation.y = -Math.PI / 2;
        g.add(rear);
        // 貨斗 (tonneau cover) 與邊框
        g.add(mk(new THREE.BoxGeometry(1.86, 0.03, W - 0.1), std('bedCover', { color: 0x23262b, roughness: 0.8 }), -1.68, 1.04, 0, true));
        // 水箱罩 + 保險桿
        g.add(mk(rbox(0.06, 0.32, 1.2, 0.02), M.darkGrey, 2.63, 0.84, 0));
        for (let i = 0; i < 4; i++) g.add(mk(new THREE.BoxGeometry(0.02, 0.025, 1.1), M.aluDark, 2.665, 0.73 + i * 0.07, 0, true));
        g.add(mk(rbox(0.16, 0.18, W + 0.04, 0.04), M.darkGrey, 2.62, 0.5, 0));
        g.add(mk(rbox(0.12, 0.16, W + 0.02, 0.04), M.darkGrey, -2.62, 0.52, 0));
        // 車燈
        [-1, 1].forEach(sd => {
            g.add(mk(rbox(0.05, 0.12, 0.3, 0.02), std('headlamp', { color: 0xdfe8f0, roughness: 0.05, metalness: 0.6, emissive: 0x334455, emissiveIntensity: 0.4 }), 2.6, 0.92, sd * 0.68, true));
            g.add(mk(rbox(0.04, 0.3, 0.12, 0.015), std('taillamp', { color: 0xb91c1c, roughness: 0.2, emissive: 0x550000, emissiveIntensity: 0.5 }), -2.63, 0.8, sd * 0.8, true));
            // 後照鏡
            g.add(mk(rbox(0.12, 0.13, 0.05, 0.02), M.darkGrey, 0.9, 1.3, sd * (W / 2 + 0.08)));
            // 門把
            [0.55, -0.25].forEach(x => g.add(mk(new THREE.BoxGeometry(0.16, 0.03, 0.02), M.darkGrey, x, 1.12, sd * (W / 2 + 0.005), true)));
        });
        // 車輪
        const tireGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 28).rotateX(Math.PI / 2);
        const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.29, 20).rotateX(Math.PI / 2);
        const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12).rotateX(Math.PI / 2);
        [1.62, -1.6].forEach(x => [-1, 1].forEach(sd => {
            const z = sd * (W / 2 - 0.12);
            g.add(mk(tireGeo, M.tire, x, 0.4, z));
            g.add(mk(rimGeo, M.alu, x, 0.4, z + sd * 0.002));
            g.add(mk(hubGeo, M.darkGrey, x, 0.4, z + sd * 0.004, true));
        }));
        // 車頂警示燈 + 行李架
        g.add(mk(rbox(0.22, 0.08, 1.1, 0.03), M.black, 0.1, 1.885, 0));
        for (let i = 0; i < 4; i++) g.add(mk(rbox(0.18, 0.06, 0.2, 0.02), std('beacon', { color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5, transparent: true, opacity: 0.9, roughness: 0.2 }), 0.1, 1.94, -0.36 + i * 0.24, true));
        // 車門標誌
        const decal = canvasTex(512, 160, (c, w, h) => {
            c.clearRect(0, 0, w, h);
            c.fillStyle = '#f26b0f'; c.fillRect(0, 118, w, 18);
            c.fillStyle = '#0b3d6e'; c.font = 'bold 64px "Microsoft JhengHei","Noto Sans TC",sans-serif';
            c.fillText('測量作業車', 10, 80);
            c.font = 'bold 26px sans-serif'; c.fillStyle = '#475569';
            c.fillText('SURVEY · GNSS · UAV', 14, 112);
        });
        const decalMat = new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
        [-1, 1].forEach(sd => {
            const d = mk(new THREE.PlaneGeometry(1.6, 0.5), decalMat, 0.0, 0.84, sd * (W / 2 + 0.006), true);
            d.rotation.y = sd > 0 ? 0 : Math.PI;
            g.add(d);
        });
        return g;
    }

    // ---------------- 野外帳篷 + 桌子 ----------------
    function buildCanopyTent() {
        const g = new THREE.Group();
        const S = 3.0, H = 2.1;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => {
            g.add(mk(new THREE.BoxGeometry(0.04, H, 0.04), M.alu, a * S / 2, H / 2, b * S / 2));
            g.add(mk(new THREE.BoxGeometry(0.12, 0.012, 0.12), M.aluDark, a * S / 2, 0.006, b * S / 2));
        });
        // 剪刀撐
        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([ax, az]) => {
            for (let k = -1; k <= 1; k += 2) {
                const p1 = ax === 0 ? V3(-S / 2, H - 0.05, az * S / 2) : V3(ax * S / 2, H - 0.05, -S / 2);
                const p2 = ax === 0 ? V3(S / 2, H - 0.35, az * S / 2) : V3(ax * S / 2, H - 0.35, S / 2);
                if (k > 0) { const t = p1.y; p1.y = p2.y; p2.y = t; }
                g.add(boxBetween(p1, p2, 0.02, 0.012, M.alu));
            }
        });
        const roof = mk(new THREE.ConeGeometry(S * 0.73, 0.75, 4, 1, true), M.canvasBlue, 0, H + 0.37, 0);
        roof.rotation.y = Math.PI / 4;
        g.add(roof);
        const valTex = canvasTex(512, 64, (c, w, h) => {
            c.fillStyle = '#1e5aa8'; c.fillRect(0, 0, w, h);
            c.fillStyle = '#ffffff'; c.font = 'bold 38px "Microsoft JhengHei","Noto Sans TC",sans-serif'; c.textAlign = 'center';
            c.fillText('外業測量 指揮站', w / 2, 46);
        });
        const valMat = new THREE.MeshStandardMaterial({ map: valTex, roughness: 0.85, side: THREE.DoubleSide });
        for (let i = 0; i < 4; i++) {
            const v = mk(new THREE.PlaneGeometry(S + 0.04, 0.25), valMat, 0, H - 0.1, 0, true);
            const a = i * Math.PI / 2;
            v.position.set(Math.sin(a) * (S / 2 + 0.01), H - 0.1, Math.cos(a) * (S / 2 + 0.01));
            v.rotation.y = a;
            g.add(v);
        }
        // 摺疊桌
        const table = new THREE.Group();
        table.add(mk(new THREE.BoxGeometry(1.5, 0.03, 0.7), M.white, 0, 0.73, 0));
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => table.add(mk(new THREE.CylinderGeometry(0.014, 0.014, 0.72, 8), M.aluDark, a * 0.68, 0.36, b * 0.3)));
        // 筆電
        const lap = new THREE.Group();
        lap.add(mk(new THREE.BoxGeometry(0.34, 0.015, 0.24), M.darkGrey, 0, 0, 0));
        const lid = new THREE.Group();
        lid.position.set(0, 0.008, -0.12);
        lid.rotation.x = -0.25;
        lid.add(mk(new THREE.BoxGeometry(0.34, 0.23, 0.01), M.darkGrey, 0, 0.115, 0));
        lid.add(mk(new THREE.PlaneGeometry(0.31, 0.2), new THREE.MeshBasicMaterial({ map: canvasTex(256, 160, (c, w, h) => {
            c.fillStyle = '#0f172a'; c.fillRect(0, 0, w, h);
            c.strokeStyle = '#22d3ee'; c.lineWidth = 2;
            c.beginPath(); c.moveTo(20, 130); c.lineTo(80, 60); c.lineTo(150, 90); c.lineTo(230, 30); c.stroke();
            c.fillStyle = '#f59e0b'; [[20, 130], [80, 60], [150, 90], [230, 30]].forEach(([x, y]) => c.fillRect(x - 4, y - 4, 8, 8));
            c.fillStyle = '#94a3b8'; c.font = '12px monospace'; c.fillText('Network Adjustment  σ0=1.02', 10, 152);
        }) }), 0, 0.115, 0.0055, true));
        lap.add(lid);
        lap.position.set(-0.3, 0.755, 0.05);
        lap.rotation.y = 0.15;
        table.add(lap);
        table.position.set(0.2, 0, -0.5);
        g.add(table);
        // 摺疊椅
        const chair = new THREE.Group();
        chair.add(mk(new THREE.BoxGeometry(0.45, 0.03, 0.42), M.canvasBlue, 0, 0.45, 0));
        chair.add(mk(new THREE.BoxGeometry(0.45, 0.42, 0.03), M.canvasBlue, 0, 0.68, -0.2));
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => chair.add(mk(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), M.black, a * 0.2, 0.225, b * 0.19)));
        chair.position.set(-0.2, 0, 0.35);
        chair.rotation.y = Math.PI + 0.3;
        g.add(chair);
        // 飲水桶
        g.add(mk(lathe([[0, 0], [0.16, 0], [0.17, 0.05], [0.17, 0.42], [0.15, 0.45], [0, 0.45]], 24), M.orange, 1.15, 0, 0.9));
        g.add(mk(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 24), M.white, 1.15, 0.47, 0.9));
        return g;
    }

    function buildCase(w, h, d, mat) {
        const g = new THREE.Group();
        g.add(mk(rbox(w, h, d, 0.03), mat, 0, h / 2, 0));
        g.add(mk(new THREE.BoxGeometry(w + 0.004, 0.012, d + 0.004), M.black, 0, h * 0.62, 0, true));
        [-1, 1].forEach(s => g.add(mk(new THREE.BoxGeometry(0.05, 0.05, 0.02), M.black, s * w * 0.3, h * 0.62, d / 2 + 0.01, true)));
        g.add(mk(rbox(w * 0.32, 0.03, 0.05, 0.01), M.black, 0, h + 0.02, 0));
        return g;
    }

    function buildCone() {
        const g = new THREE.Group();
        g.add(mk(new THREE.BoxGeometry(0.38, 0.03, 0.38), M.black, 0, 0.015, 0));
        const tex = canvasTex(64, 128, (c, w, h) => {
            c.fillStyle = '#f26b0f'; c.fillRect(0, 0, w, h);
            c.fillStyle = '#f8fafc'; c.fillRect(0, 34, w, 16); c.fillRect(0, 70, w, 14);
        });
        g.add(mk(new THREE.CylinderGeometry(0.025, 0.15, 0.68, 20, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, side: THREE.DoubleSide }), 0, 0.37, 0));
        return g;
    }

    function buildFlagStake() {
        const g = new THREE.Group();
        g.add(mk(new THREE.BoxGeometry(0.04, 0.55, 0.04), M.wood, 0, 0.2, 0));
        g.add(mk(new THREE.BoxGeometry(0.042, 0.08, 0.042), std('stakeRed', { color: 0xdc2626, roughness: 0.7 }), 0, 0.44, 0, true));
        const rib = new THREE.PlaneGeometry(0.035, 0.38, 1, 6);
        const p = rib.attributes.position;
        for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, Math.sin((y + 0.19) * 6) * 0.03 + (0.19 - y) * 0.15); }
        rib.computeVertexNormals();
        const r = mk(rib, std('flagging', { color: 0xff2d95, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x550022, emissiveIntensity: 0.3 }), 0.025, 0.28, 0, true);
        g.add(r);
        return g;
    }

    window.SurveyModels = {
        V3, rng, fbm, vnoise, smoothstep, hash2,
        M, mk, rodBetween, boxBetween, rbox, lathe, canvasTex, jitter, mergeColored, mat4, colVar, col,
        setAnisotropy: (a) => { maxAniso = a; },
        buildInstrumentStation, decorateLevelStaff, buildPrismPole, buildMonument, buildDrone,
        coniferParts, broadleafParts, palmParts, rockGeo,
        buildSurveyTruck, buildCanopyTent, buildCase, buildCone, buildFlagStake
    };
})();
