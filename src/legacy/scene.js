/**
 * 3D Surveyor World Scene (Three.js r128)
 * 管理天空、光照、地形、植被、環境道具，以及測量儀器、標尺、航測標、無人機模型。
 * 細部建模函式位於 js/models.js (window.SurveyModels)。
 */
class SurveyScene {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 2000);
        const G0 = (window.__mobileGfx || {});
        this.renderer = new THREE.WebGLRenderer({ antialias: G0.antialias !== false, alpha: false, powerPreference: 'high-performance' });
        this.interactiveObjects = [];
        this.droneModel = null;
        this.propellers = [];
        this.levelStaffs = [];
        this.gcpMarkers = [];
        this.benchmarks = [];
        this.tripods = [];
        this.trees = [];
        this.floatingArrows = [];
        this.dynamicArrows = [];
        this.stationPads = [];
        this.clouds = [];
        this.animTime = 0;
        this._lastRender = performance.now();

        // 地形中央作業區 (平坦) 與禁止擺放植被的區域
        this.keepouts = [
            { x: 0, z: 0, r: 5 },        // CKSV / UAV Home
            { x: 0, z: 3.5, r: 2.5 },    // 出生點
            { x: 10, z: -10, r: 3.5 },   // BM-01
            { x: 22, z: -28, r: 3.5 },   // BM-02
            { x: -10, z: -12, r: 4 },    // GCP-01
            { x: -15, z: 15, r: 3 },     // CP-03
            { x: 10, z: 0, r: 2.5 },     // Prism
            { x: -9, z: 7, r: 4.5 },     // 測量車
            { x: 8, z: 8, r: 3.2 },      // 帳篷
            { x: -15, z: -15, r: 3 }, { x: 15, z: -15, r: 3 }, { x: 15, z: 15, r: 3 }, { x: -15, z: 15, r: 3 } // UAV GCPs
        ];
        // 步道 (x1,z1,x2,z2,半寬)
        this.pathSegs = [];
        // 整平區 (公司倉庫場地)：地形在半徑內平滑壓平至中心高度
        this.flatZones = [{ x: -150, z: 68, r: 20, h: null }];
        // 第三天航測現場 (公司出門左轉，縣道北側農地)：整片壓平，植被另外處理 (不影響其他地方的亂數擺放)
        this.siteZones = [{ x: -250, z: 10, r: 50, h: null }];
        this.siteRect = { x0: -295, x1: -205, z0: -30, z1: 44 };
        this.poleColliders = [];

        this.init();
    }

    init() {
        const SM = window.SurveyModels;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, (window.__mobileGfx || {}).dpr || 2));
        this.renderer.shadowMap.enabled = (window.__mobileGfx || {}).shadow !== false;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.82;
        this.container.appendChild(this.renderer.domElement);
        SM.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

        this.sunDir = new THREE.Vector3(45, 70, 40).normalize();
        this.horizonColor = new THREE.Color(0xd5e4ef);
        this.scene.background = this.horizonColor.clone();
        this.scene.fog = new THREE.Fog(0xcfdeea, 90, 520);

        this.setupSky();
        this.setupLighting();
        this.buildEnvironmentMap();
        this.buildTerrain();
        this.buildBackdrop();
        this.buildEnvironmentProps();
        this.buildVegetation();

        window.addEventListener('resize', () => this.onWindowResize());
    }

    // ------------------------------------------------------------------
    // 地形高度函式 (中央 ±56m 完全平坦，外圍平滑升起為丘陵)
    // ------------------------------------------------------------------
    /**
     * 地表高度。道路走廊內 (|z-48| ≤ 4.6) 完全壓平到道路縱斷面 roadH(x)，
     * 確保道路面永遠高於地形，不會有地形穿出路面的破圖。
     */
    heightAt(x, z) {
        const b = this.baseHeightAt(x, z);
        const dz = Math.abs(z - 48);
        if (dz >= 14) return b;
        const t = 1 - window.SurveyModels.smoothstep(4.6, 14, dz);
        return b + (this.roadH(x) - b) * t;
    }

    /** 道路縱斷面：沿線取平均讓坡度平順 (以 0.5 m 快取) */
    roadH(x) {
        if (!this._roadCache) this._roadCache = new Map();
        const k = Math.round(x * 2);
        let v = this._roadCache.get(k);
        if (v === undefined) {
            const xx = k / 2;
            v = 0;
            for (let o = -12; o <= 12; o += 4) v += this.baseHeightAt(xx + o, 48);
            v /= 7;
            this._roadCache.set(k, v);
        }
        return v;
    }

    baseHeightAt(x, z) {
        let h = this.rawHeightAt(x, z);
        if (this.flatZones) {
            for (const fz of this.flatZones) {
                if (fz.h === null) fz.h = this.rawHeightAt(fz.x, fz.z);
                const d = Math.hypot(x - fz.x, z - fz.z);
                const t = window.SurveyModels.smoothstep(fz.r, fz.r + 18, d);
                h = fz.h + (h - fz.h) * t;
            }
        }
        if (this.siteZones) {
            for (const fz of this.siteZones) {
                if (fz.h === null) fz.h = this.rawHeightAt(fz.x, fz.z);
                const d = Math.hypot(x - fz.x, z - fz.z);
                const t = window.SurveyModels.smoothstep(fz.r, fz.r + 18, d);
                h = fz.h + (h - fz.h) * t;
            }
        }
        return h;
    }

    rawHeightAt(x, z) {
        const SM = window.SurveyModels;
        const m = Math.max(Math.abs(x), Math.abs(z));
        const f = SM.smoothstep(56, 90, m);
        if (f <= 0) return 0;
        const h = SM.fbm(x * 0.012, z * 0.012) * 9 + SM.fbm(x * 0.045 + 100, z * 0.045) * 1.6;
        const far = SM.smoothstep(150, 330, Math.hypot(x, z)) * (16 + 22 * SM.fbm(x * 0.006 + 50, z * 0.006));
        return f * (h + Math.max(0, far));
    }

    /** 第三天現場範圍內 (植被不擺這裡，由現場自己建) */
    inSite(x, z, m = 0) {
        const R = this.siteRect;
        return !!R && x > R.x0 - m && x < R.x1 + m && z > R.z0 - m && z < R.z1 + m;
    }

    distToPaths(x, z) {
        let best = Infinity;
        for (const [x1, z1, x2, z2, w] of this.pathSegs) {
            const dx = x2 - x1, dz = z2 - z1;
            const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
            const d = Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)) - w;
            if (d < best) best = d;
        }
        return best;
    }

    isClear(x, z, r = 0) {
        for (const k of this.keepouts) if (Math.hypot(x - k.x, z - k.z) < k.r + r) return false;
        if (this.flatZones && this.flatZones.some(fz => Math.hypot(x - fz.x, z - fz.z) < fz.r + 6 + r)) return false;
        if (this.distToPaths(x, z) < r + 0.3) return false;
        if (Math.abs(z - 48) < 5 + r) return false; // 道路
        // 水準測量視線走廊 BM-01 → BM-02
        const dx = 12, dz = -18, t = Math.max(0, Math.min(1, ((x - 10) * dx + (z + 10) * dz) / (dx * dx + dz * dz)));
        if (Math.hypot(x - (10 + t * dx), z - (-10 + t * dz)) < 5 + r) return false;
        return true;
    }

    // ------------------------------------------------------------------
    // 天空：漸層天空穹頂 + 太陽光暈
    // ------------------------------------------------------------------
    setupSky() {
        const skyGeo = new THREE.SphereGeometry(1500, 48, 24);
        this.skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
                topColor: { value: new THREE.Color(0x2f6fc0) },
                midColor: { value: new THREE.Color(0x8fbbe6) },
                horizonColor: { value: this.horizonColor.clone() },
                groundColor: { value: new THREE.Color(0x5d6b4a) },
                sunDir: { value: this.sunDir.clone() }
            },
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_Position = p.xyww;
                }`,
            fragmentShader: `
                uniform vec3 topColor; uniform vec3 midColor; uniform vec3 horizonColor; uniform vec3 groundColor; uniform vec3 sunDir;
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    float h = d.y;
                    vec3 col;
                    if (h > 0.0) {
                        col = mix(horizonColor, midColor, smoothstep(0.0, 0.18, h));
                        col = mix(col, topColor, smoothstep(0.15, 0.9, h));
                    } else {
                        col = mix(horizonColor, groundColor, smoothstep(0.0, 0.12, -h));
                    }
                    float s = max(dot(d, normalize(sunDir)), 0.0);
                    col += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 6.0 + pow(s, 60.0) * 0.35 + pow(s, 8.0) * 0.12);
                    gl_FragColor = vec4(col, 1.0);
                    #include <colorspace_fragment>
                }`
        });
        this.sky = new THREE.Mesh(skyGeo, this.skyMat);
        this.sky.frustumCulled = false;
        this.sky.renderOrder = -1;
        this.scene.add(this.sky);
    }

    setupLighting() {
        this.hemiLight = new THREE.HemisphereLight(0xcfe3ff, 0x4a5636, 1.0);
        this.scene.add(this.hemiLight);

        const sunLight = new THREE.DirectionalLight(0xfff0d8, 5.2);
        sunLight.position.copy(this.sunDir).multiplyScalar(120);
        sunLight.castShadow = true;
        const shadowRes = (window.__mobileGfx || {}).shadowRes || 2048;
        sunLight.shadow.mapSize.width = shadowRes;
        sunLight.shadow.mapSize.height = shadowRes;
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = 300;
        const d = (window.__mobileGfx || {}).shadowD || 38;
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;
        sunLight.shadow.bias = -0.0004;
        sunLight.shadow.normalBias = 0.03;
        sunLight.shadow.camera.layers.enable(1); // 無人機在 layer 1：FPV 時不顯示但仍投影
        this.scene.add(sunLight);
        this.scene.add(sunLight.target);
        this.sunLight = sunLight;
    }

    /** 以天空產生 PMREM 環境貼圖，讓金屬/玻璃有真實反射 */
    buildEnvironmentMap() {
        try {
            const envScene = new THREE.Scene();
            // 以頂點色重建天空漸層 (MeshBasicMaterial 於各平台 PMREM 最穩定)
            const sg = new THREE.SphereGeometry(100, 48, 24);
            const sp = sg.attributes.position;
            const cols = new Float32Array(sp.count * 3);
            const top = new THREE.Color(0x2f6fc0), mid = new THREE.Color(0x8fbbe6), hor = this.horizonColor, gnd = new THREE.Color(0x56643f);
            const c = new THREE.Color(), v = new THREE.Vector3();
            const ss = (a0, b0, x) => { const t = Math.min(1, Math.max(0, (x - a0) / (b0 - a0))); return t * t * (3 - 2 * t); };
            for (let i = 0; i < sp.count; i++) {
                v.set(sp.getX(i), sp.getY(i), sp.getZ(i)).normalize();
                if (v.y > 0) c.copy(hor).lerp(mid, ss(0, 0.18, v.y)).lerp(top, ss(0.15, 0.9, v.y));
                else c.copy(hor).lerp(gnd, ss(0, 0.12, -v.y));
                const s0 = Math.max(0, v.dot(this.sunDir));
                const glow = Math.pow(s0, 8) * 0.25;
                c.r = Math.min(1, c.r + glow); c.g = Math.min(1, c.g + glow * 0.95); c.b = Math.min(1, c.b + glow * 0.85);
                cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
            }
            sg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
            envScene.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
            const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            sun.position.copy(this.sunDir).multiplyScalar(90);
            envScene.add(sun);
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            const rt = pmrem.fromScene(envScene, 0.02, 0.1, 500);
            this.scene.environment = rt.texture;
            pmrem.dispose();
        } catch (e) {
            console.warn('Environment map unavailable', e);
        }
    }

    // ------------------------------------------------------------------
    // 地形
    // ------------------------------------------------------------------
    buildTerrain() {
        const SM = window.SurveyModels;
        const size = 720, seg = 180;
        const geo = new THREE.PlaneGeometry(size, size, seg, seg);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const lush = new THREE.Color(0.78, 0.92, 0.66), dry = new THREE.Color(0.95, 0.9, 0.62), dark = new THREE.Color(0.55, 0.7, 0.5), forest = new THREE.Color(0.38, 0.52, 0.36);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            pos.setY(i, this.heightAt(x, z));
            const n1 = SM.fbm(x * 0.03, z * 0.03) * 0.5 + 0.5;
            const n2 = SM.fbm(x * 0.008 + 20, z * 0.008 - 7) * 0.5 + 0.5;
            c.copy(lush).lerp(dry, SM.smoothstep(0.45, 0.8, n2)).lerp(dark, SM.smoothstep(0.55, 0.9, n1) * 0.6);
            c.lerp(forest, SM.smoothstep(110, 220, Math.hypot(x, z)) * 0.85);
            c.convertSRGBToLinear();
            colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();

        const grassTex = SM.canvasTex(512, 512, (ctx, w, h) => {
            ctx.fillStyle = '#4f8030'; ctx.fillRect(0, 0, w, h);
            const r = SM.rng(11);
            for (let i = 0; i < 9000; i++) {
                const x = r() * w, y = r() * h, l = 3 + r() * 9;
                const g = 110 + Math.floor(r() * 70);
                ctx.strokeStyle = `rgba(${50 + Math.floor(r() * 50)},${g},${30 + Math.floor(r() * 30)},${0.35 + r() * 0.4})`;
                ctx.lineWidth = 1 + r();
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 4, y - l); ctx.stroke();
            }
            for (let i = 0; i < 500; i++) {
                ctx.fillStyle = `rgba(${110 + r() * 40},${90 + r() * 30},${60 + r() * 20},0.35)`;
                ctx.fillRect(r() * w, r() * h, 1.5 + r() * 2, 1.5 + r() * 2);
            }
        }, { repeat: [size / 5, size / 5] });

        const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.45 });
        const ground = new THREE.Mesh(geo, groundMat);
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.ground = ground;

        this.buildPathOverlay();
    }

    /** 外業步道/車轍 (繪製於中央平坦區的貼花層) */
    buildPathOverlay() {
        const SM = window.SurveyModels;
        const half = 55, res = 2048, ppm = res / (half * 2);
        const P = (x, z) => [(x + half) * ppm, (z + half) * ppm];
        const paths = [
            { pts: [[-9, 45], [-9.2, 30], [-9, 14], [-8.5, 10]], w: 0.55, ruts: true },
            { pts: [[-6.5, 5.5], [-3, 3], [-0.8, 1]], w: 0.55 },
            { pts: [[0.8, -0.8], [5, -5], [9, -9]], w: 0.5 },
            { pts: [[11, -11.5], [15, -17.5], [18.5, -23], [21, -26.5]], w: 0.5 },
            { pts: [[-0.8, -0.8], [-4, -5], [-8, -9.5]], w: 0.5 },
            { pts: [[6.8, 6.5], [4, 4], [1, 1.2]], w: 0.45 }
        ];
        paths.forEach(p => {
            for (let i = 0; i < p.pts.length - 1; i++) {
                const [a, b] = [p.pts[i], p.pts[i + 1]];
                this.pathSegs.push([a[0], a[1], b[0], b[1], p.ruts ? 1.3 : p.w + 0.3]);
            }
        });

        const tex = SM.canvasTex(res, res, (ctx) => {
            ctx.clearRect(0, 0, res, res);
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            const stroke = (pts, wM, style, off = 0) => {
                ctx.strokeStyle = style; ctx.lineWidth = wM * ppm;
                ctx.beginPath();
                pts.forEach(([x, z], i) => {
                    const [px, pz] = P(x + off, z);
                    if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
                });
                ctx.stroke();
            };
            paths.forEach(p => {
                if (p.ruts) {
                    [-0.8, 0.8].forEach(o => {
                        stroke(p.pts, 0.9, 'rgba(120,98,66,0.35)', o);
                        stroke(p.pts, 0.5, 'rgba(126,104,72,0.85)', o);
                    });
                } else {
                    stroke(p.pts, p.w * 2.6, 'rgba(128,108,74,0.28)');
                    stroke(p.pts, p.w * 1.7, 'rgba(136,114,80,0.6)');
                    stroke(p.pts, p.w * 1.1, 'rgba(146,124,88,0.9)');
                }
            });
            // 測站周邊踏痕
            [[0, 0, 3.2], [10, -10, 2.0], [22, -28, 2.0], [-10, -12, 2.4], [-9, 7, 3.5], [8, 8, 2.2]].forEach(([x, z, r]) => {
                const [px, pz] = P(x, z);
                const g = ctx.createRadialGradient(px, pz, 0, px, pz, r * ppm);
                g.addColorStop(0, 'rgba(132,112,78,0.55)'); g.addColorStop(1, 'rgba(132,112,78,0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, pz, r * ppm, 0, Math.PI * 2); ctx.fill();
            });
            // 碎石顆粒
            const r = SM.rng(5);
            const img = ctx.getImageData(0, 0, res, res);
            const d = img.data;
            for (let i = 0; i < 260000; i++) {
                const x = Math.floor(r() * res), y = Math.floor(r() * res);
                const k = (y * res + x) * 4;
                if (d[k + 3] > 60) {
                    const v = r() > 0.5 ? 30 : -35;
                    d[k] = Math.max(0, Math.min(255, d[k] + v)); d[k + 1] = Math.max(0, Math.min(255, d[k + 1] + v)); d[k + 2] = Math.max(0, Math.min(255, d[k + 2] + v));
                }
            }
            ctx.putImageData(img, 0, 0);
        });
        const geo = new THREE.PlaneGeometry(half * 2, half * 2);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({
            map: tex, transparent: true, roughness: 1.0, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
        });
        const overlay = new THREE.Mesh(geo, mat);
        overlay.position.y = 0.004;
        overlay.receiveShadow = true;
        overlay.renderOrder = 1;
        this.scene.add(overlay);
    }

    // ------------------------------------------------------------------
    // 遠景：山脈、雲、道路、電線桿
    // ------------------------------------------------------------------
    buildBackdrop() {
        const SM = window.SurveyModels;
        // 山脈 (三層，越遠越淡)
        const ridges = [
            { R: 640, base: 30, amp: 120, freq: 2.6, near: 0x5f7a6a, top: 0x7f97a0, seed: 3 },
            { R: 780, base: 60, amp: 190, freq: 1.9, near: 0x7d95a6, top: 0x9db1c2, seed: 9 },
            { R: 930, base: 90, amp: 260, freq: 1.4, near: 0xa3b6c6, top: 0xbccbd8, seed: 17 }
        ];
        ridges.forEach((rd, ri) => {
            const N = 360;
            const positions = [], colors = [];
            const cNear = new THREE.Color(rd.near), cTop = new THREE.Color(rd.top), cHaze = this.horizonColor;
            const hs = [];
            for (let i = 0; i <= N; i++) {
                const a = i / N * Math.PI * 2;
                let n = SM.fbm(Math.cos(a) * rd.freq + rd.seed, Math.sin(a) * rd.freq + rd.seed, 5) * 0.5 + 0.5;
                n = Math.pow(n, 1.6);
                hs.push(rd.base + rd.amp * n);
            }
            for (let i = 0; i < N; i++) {
                const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
                const p = (a, h) => [Math.cos(a) * rd.R, h, Math.sin(a) * rd.R];
                const t0 = p(a0, hs[i]), t1 = p(a1, hs[i + 1]), b0 = p(a0, -30), b1 = p(a1, -30);
                positions.push(...b0, ...t0, ...t1, ...b0, ...t1, ...b1);
                const ct = (h) => cNear.clone().lerp(cTop, Math.min(1, h / (rd.base + rd.amp)));
                const cb = cHaze.clone().lerp(cNear, 0.25 + ri * 0.05);
                [cb, ct(hs[i]), ct(hs[i + 1]), cb, ct(hs[i + 1]), cb].forEach(cc => colors.push(cc.r, cc.g, cc.b));
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
            m.renderOrder = -1 + ri * -0.01;
            m.frustumCulled = false;
            this.scene.add(m);
        });

        // 雲
        const cloudTex = SM.canvasTex(256, 128, (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h);
            const r = SM.rng(23);
            for (let i = 0; i < 26; i++) {
                const x = 40 + r() * 176, y = 50 + r() * 40, rad = 18 + r() * 30;
                const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
                g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.6, 'rgba(250,252,255,0.45)'); g.addColorStop(1, 'rgba(240,245,255,0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
            }
            const sh = ctx.createLinearGradient(0, 60, 0, 128);
            sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(120,135,160,0.25)');
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = sh; ctx.fillRect(0, 0, w, h);
        });
        const r = SM.rng(31);
        for (let i = 0; i < 22; i++) {
            const mat = new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, depthWrite: false, opacity: 0.75 + r() * 0.2 });
            const s = new THREE.Sprite(mat);
            const a = r() * Math.PI * 2, d = 250 + r() * 600;
            s.position.set(Math.cos(a) * d, 140 + r() * 120, Math.sin(a) * d);
            const sc = 120 + r() * 180;
            s.scale.set(sc, sc * 0.45, 1);
            s.userData.drift = 0.6 + r() * 0.8;
            this.scene.add(s);
            this.clouds.push(s);
        }

        this.buildRoad();
    }

    buildRoad() {
        const SM = window.SurveyModels;
        const zc = 48, halfW = 3.4;
        const xs = [];
        for (let x = -380; x <= 380; x += 4) xs.push(x);
        const pos = [], uv = [], idx = [];
        xs.forEach((x, i) => {
            const ry = this.roadH(x) + 0.035;
            pos.push(x, ry, zc - halfW, x, ry, zc + halfW);
            uv.push(0, x / 8, 1, x / 8);
            if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const tex = SM.canvasTex(256, 512, (ctx, w, h) => {
            ctx.fillStyle = '#4b4e52'; ctx.fillRect(0, 0, w, h);
            const r = SM.rng(41);
            for (let i = 0; i < 9000; i++) {
                const v = 50 + Math.floor(r() * 60);
                ctx.fillStyle = `rgba(${v},${v},${v + 4},0.5)`; ctx.fillRect(r() * w, r() * h, 1.5, 1.5);
            }
            ctx.fillStyle = '#e8e6df';
            ctx.fillRect(10, 0, 7, h); ctx.fillRect(w - 17, 0, 7, h);
            ctx.fillStyle = '#e8c547';
            ctx.fillRect(w / 2 - 7, 0, 5, h); ctx.fillRect(w / 2 + 2, 0, 5, h);
        });
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        road.receiveShadow = true;
        this.scene.add(road);

        // 路肩 (gravel shoulders) 與電線桿 + 電線
        const parts = [], wireParts = [];
        const poleZ = zc + halfW + 2.2;
        const tops = [];
        const grey = SM.col(0x9b9a94), dark = SM.col(0x3b3d40), white = SM.col(0xe8e8e2);
        for (let x = -352; x <= 352; x += 32) {
            const y0 = this.heightAt(x, poleZ);
            const pg = new THREE.CylinderGeometry(0.11, 0.16, 11, 10);
            parts.push({ geo: pg, color: grey, matrix: SM.mat4(x, y0 + 5.0, poleZ) });
            parts.push({ geo: new THREE.BoxGeometry(0.12, 0.12, 2.0), color: dark, matrix: SM.mat4(x, y0 + 9.6, poleZ) });
            [-0.85, 0, 0.85].forEach(o => parts.push({ geo: new THREE.CylinderGeometry(0.05, 0.06, 0.22, 8), color: white, matrix: SM.mat4(x, y0 + 9.78, poleZ + o) }));
            if (((x / 32) | 0) % 3 === 0) parts.push({ geo: new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), color: SM.col(0x7c8288), matrix: SM.mat4(x, y0 + 7.8, poleZ - 0.4) });
            tops.push([x, y0 + 9.9]);
            this.poleColliders.push({ x, z: poleZ, r: 0.35 });
        }
        const poles = new THREE.Mesh(SM.mergeColored(parts), SM.M.vertexSmooth);
        poles.castShadow = true; poles.receiveShadow = true;
        this.scene.add(poles);
        for (let i = 0; i < tops.length - 1; i++) {
            [-0.85, 0, 0.85].forEach(o => {
                const [x1, y1] = tops[i], [x2, y2] = tops[i + 1];
                const pts = [];
                for (let k = 0; k <= 10; k++) {
                    const t = k / 10;
                    pts.push(new THREE.Vector3(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t - Math.sin(Math.PI * t) * 0.55, poleZ + o));
                }
                wireParts.push({ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.014, 4), color: SM.col(0x1a1a1a) });
            });
        }
        this.scene.add(new THREE.Mesh(SM.mergeColored(wireParts), SM.M.vertexSmooth));
    }

    // ------------------------------------------------------------------
    // 環境道具：控制點、測量車、帳篷、器材箱、交通錐、標示木樁
    // ------------------------------------------------------------------
    buildEnvironmentProps() {
        const SM = window.SurveyModels;
        // Survey monuments / control points
        this.createMonument(0, 0, 0, "CKSV (一等衛星控制點)");
        this.createMonument(10, 0, -10, "BM-01 (水準起點)");
        this.createMonument(22, 0, -28, "BM-02 (水準轉折點)");

        // 測量作業車
        const truck = SM.buildSurveyTruck();
        this.parkedTruck = truck;
        truck.position.set(-9.5, 0, 8);
        truck.rotation.y = Math.PI / 2 + 0.18;
        this.scene.add(truck);

        // 野外指揮帳篷
        const tent = SM.buildCanopyTent();
        tent.position.set(8.5, 0, 8.5);
        tent.rotation.y = -0.35;
        this.scene.add(tent);
        this.siteProps = [tent];

        // 器材箱
        const cases = [
            [SM.buildCase(0.62, 0.36, 0.42, SM.M.yellow), -6.4, 5.6, 0.4],
            [SM.buildCase(0.5, 0.3, 0.36, SM.M.orange), -6.2, 6.5, -0.2],
            [SM.buildCase(1.1, 0.2, 0.3, SM.M.darkGrey), -6.9, 4.8, 1.2],
            [SM.buildCase(0.5, 0.42, 0.4, SM.M.yellow), 7.0, 6.6, 0.3]
        ];
        cases.forEach(([g, x, z, ry]) => { g.position.set(x, 0, z); g.rotation.y = ry; this.scene.add(g); this.siteProps.push(g); });

        // 點位旁的標示木樁 (pink flagging)
        [[1.6, -1.4, 0.3], [11.4, -9.2, 1.1], [23.2, -27.0, 2.0], [-8.6, -13.4, 0.7]].forEach(([x, z, ry]) => {
            const s = SM.buildFlagStake(); s.position.set(x, 0, z); s.rotation.y = ry; this.scene.add(s);
        });
    }

    // ------------------------------------------------------------------
    // 植被：近景樹木、遠景森林、檳榔樹、岩石、草叢
    // ------------------------------------------------------------------
    buildVegetation() {
        const SM = window.SurveyModels;
        // 地標樹 (GCP-01 遠照參考地物)
        this.createTree(-18, -20, 'broad');
        this.createTree(-5, -23, 'conifer');
        this.createTree(-22, -10, 'broad');

        const r = SM.rng(2024);
        let placed = 0, tries = 0;
        while (placed < 34 && tries < 3000) {
            tries++;
            const a = r() * Math.PI * 2, d = 24 + r() * 62;
            const x = Math.cos(a) * d, z = Math.sin(a) * d;
            if (!this.isClear(x, z, 3)) continue;
            if (this.trees.some(t => Math.hypot(t.position.x - x, t.position.z - z) < 5)) continue;
            this.createTree(x, z, r() > 0.45 ? 'broad' : 'conifer', r);
            placed++;
        }

        // 遠景森林 (合併為少數 mesh)
        const chunks = [[], [], [], []];
        for (let i = 0; i < 520; i++) {
            const a = r() * Math.PI * 2, d = 95 + Math.pow(r(), 0.8) * 230;
            const x = Math.cos(a) * d, z = Math.sin(a) * d;
            if (Math.abs(z - 48) < 7) continue;
            if (this.flatZones.some(fz => Math.hypot(x - fz.x, z - fz.z) < fz.r + 8)) continue;
            const s = 0.9 + r() * 0.7;
            const m = SM.mat4(x, this.heightAt(x, z) - 0.2, z, 0, r() * 6, 0, s);
            const q = (x > 0 ? 1 : 0) + (z > 0 ? 2 : 0);
            const into = this.inSite(x, z, 6) ? [] : chunks[q];
            if (r() > 0.5) SM.coniferParts(r, 1, into, m); else SM.broadleafParts(r, 1, into, m);
        }
        chunks.forEach(parts => {
            if (!parts.length) return;
            const mesh = new THREE.Mesh(SM.mergeColored(parts), SM.M.vertexFlat);
            mesh.receiveShadow = false; mesh.castShadow = false;
            this.scene.add(mesh);
        });

        // 檳榔樹林 (台灣鄉間) — 道路北側
        const trunkParts = [], frondParts = [];
        for (let i = 0; i < 26; i++) {
            const x = -70 + r() * 50 + (i > 13 ? 95 : 0), z = 56 + r() * 16;
            const tp = [], fp = [];
            SM.palmParts(r, 0.9 + r() * 0.3, tp, fp);
            const m = SM.mat4(x, this.heightAt(x, z) - 0.1, z, 0, r() * 6, 0);
            if (this.inSite(x, z, 4)) continue;
            tp.forEach(p => { p.matrix = m; trunkParts.push(p); });
            fp.forEach(p => { p.matrix = m; frondParts.push(p); });
        }
        const pt = new THREE.Mesh(SM.mergeColored(trunkParts), SM.M.vertexFlat);
        const pf = new THREE.Mesh(SM.mergeColored(frondParts), SM.M.vertexFlatDS);
        [pt, pf].forEach(m => { m.castShadow = true; m.receiveShadow = true; this.scene.add(m); });

        // 岩石
        const rockParts = [];
        for (let i = 0; i < 90; i++) {
            const a = r() * Math.PI * 2, d = 14 + Math.pow(r(), 0.7) * 150;
            const x = Math.cos(a) * d, z = Math.sin(a) * d;
            if (!this.isClear(x, z, 1)) continue;
            const s = d < 60 ? 0.25 + r() * 0.5 : 0.6 + r() * 1.8;
            const g = SM.rockGeo(r, s);
            g.translate(x, this.heightAt(x, z) + s * 0.12, z);
            const shade = 0.42 + r() * 0.18;
            if (this.inSite(x, z)) continue;
            rockParts.push({ geo: g, color: new THREE.Color().setRGB(shade, shade * 0.98, shade * 0.93, THREE.SRGBColorSpace) });
        }
        const rocks = new THREE.Mesh(SM.mergeColored(rockParts), SM.M.vertexFlat);
        rocks.castShadow = true; rocks.receiveShadow = true;
        this.scene.add(rocks);

        // 隨機樹若落在第三天現場就移掉 (現場的樹由現場自己種)
        this.trees = this.trees.filter(t => {
            if (!this.inSite(t.position.x, t.position.z, 3)) return true;
            this.scene.remove(t);
            return false;
        });

        this.buildGrass(r);
    }

    buildGrass(r) {
        const SM = window.SurveyModels;
        const makeTex = (flowers) => SM.canvasTex(128, 128, (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h);
            const rr = SM.rng(flowers ? 8 : 4);
            for (let i = 0; i < 22; i++) {
                const x0 = 10 + rr() * 108, top = 20 + rr() * 70, bend = (rr() - 0.5) * 30, bw = 2 + rr() * 3.5;
                const g = ctx.createLinearGradient(0, h, 0, top);
                g.addColorStop(0, '#47722b'); g.addColorStop(1, rr() > 0.5 ? '#a6cf5e' : '#8dbd4c');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.moveTo(x0 - bw, h);
                ctx.quadraticCurveTo(x0 + bend * 0.4, (h + top) / 2, x0 + bend, top);
                ctx.quadraticCurveTo(x0 + bend * 0.4 + 1, (h + top) / 2, x0 + bw, h);
                ctx.fill();
            }
            if (flowers) {
                const cols = ['#fde047', '#ffffff', '#f9a8d4', '#c4b5fd'];
                for (let i = 0; i < 6; i++) {
                    const x = 18 + rr() * 92, y = 22 + rr() * 40;
                    ctx.fillStyle = cols[Math.floor(rr() * cols.length)];
                    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.6, 0, Math.PI * 2); ctx.fill(); }
                    ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
                }
            }
        });

        // 三片交叉面
        const buildGeo = () => {
            const pos = [], uv = [], nor = [];
            // 每片正反兩面各自朝外 (FrontSide + 法線朝上)，避免 DoubleSide 背面變黑
            for (let k = 0; k < 6; k++) {
                const g = new THREE.PlaneGeometry(0.6, 0.42).toNonIndexed();
                g.translate(0, 0.21, 0);
                g.rotateY((k % 3) * Math.PI / 3 + (k >= 3 ? Math.PI : 0));
                pos.push(...g.attributes.position.array);
                uv.push(...g.attributes.uv.array);
                for (let i = 0; i < g.attributes.position.count; i++) nor.push(0, 1, 0);
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
            return g;
        };
        // 鋪面遮罩：測站墊、航測標、起降墊等位置的草會自動縮到 0
        this.paveExtra = [];
        this.grassUniforms = {
            uTime: { value: 0 },
            uPave: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
            uPaveN: { value: 0 }
        };
        const makeMat = (tex) => {
            const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.FrontSide, roughness: 1.0, metalness: 0, envMapIntensity: 0.45 });
            m.onBeforeCompile = (shader) => {
                shader.uniforms.uTime = this.grassUniforms.uTime;
                shader.uniforms.uPave = this.grassUniforms.uPave;
                shader.uniforms.uPaveN = this.grassUniforms.uPaveN;
                shader.vertexShader = 'uniform float uTime;\nuniform vec4 uPave[24];\nuniform int uPaveN;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                    #ifdef USE_INSTANCING
                    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
                    #else
                    vec3 ip = vec3(0.0);
                    #endif
                    float sway = sin(uTime * 1.8 + ip.x * 0.35 + ip.z * 0.22) * 0.07 + sin(uTime * 3.1 + ip.z * 0.9) * 0.025;
                    transformed.x += sway * position.y * 2.0;
                    transformed.z += sway * 0.6 * position.y * 2.0;
                    // 距離淡出：遠處/高空俯瞰時草叢縮小隱藏，避免雜訊
                    vec3 wpos = (modelMatrix * vec4(ip, 1.0)).xyz;
                    float gFade = 1.0 - smoothstep(20.0, 34.0, distance(wpos, cameraPosition));
                    for (int i = 0; i < 24; i++) {
                        if (i >= uPaveN) break;
                        if (distance(wpos.xz, uPave[i].xy) < uPave[i].z + 0.4) gFade = 0.0;
                    }
                    transformed *= gFade;`);
            };
            return m;
        };
        const geo = buildGeo();
        const place = (mesh, count, rMin, rMax, sMin, sMax, tint) => {
            const dummy = new THREE.Object3D();
            const c = new THREE.Color();
            let n = 0, tries = 0;
            while (n < count && tries < count * 6) {
                tries++;
                const a = r() * Math.PI * 2, d = rMin + Math.sqrt(r()) * (rMax - rMin);
                const x = Math.cos(a) * d, z = Math.sin(a) * d;
                if (this.distToPaths(x, z) < 0.45) continue;
                if (Math.abs(z - 48) < 4.6) continue;
                if (this.inSite(x, z)) continue;
                let bad = false;
                for (const k of this.keepouts) {
                    const rr = (k.r > 4 ? 2.2 : 1.4);
                    if (Math.hypot(x - k.x, z - k.z) < rr) { bad = true; break; }
                }
                if (bad) continue;
                const s = sMin + r() * (sMax - sMin);
                dummy.position.set(x, this.heightAt(x, z) - 0.02, z);
                dummy.rotation.set(0, r() * Math.PI, 0);
                dummy.scale.set(s, s * (0.8 + r() * 0.5), s);
                dummy.updateMatrix();
                mesh.setMatrixAt(n, dummy.matrix);
                c.setHSL(tint[0] + (r() - 0.5) * 0.04, tint[1], tint[2] + (r() - 0.5) * 0.18, THREE.SRGBColorSpace);
                mesh.setColorAt(n, c);
                n++;
            }
            mesh.count = n;
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        };
        // 手機版可以用 window.__mobileGfx.grass 降低草叢數量
        const G = (window.__mobileGfx || {});
        const nGrass = G.grass || 12000, nFlower = Math.round(nGrass / 10);
        const grass = new THREE.InstancedMesh(geo, makeMat(makeTex(false)), nGrass + 200);
        place(grass, nGrass, 0, 62, 0.6, 1.2, [0.22, 0.3, 0.88]);
        const flowers = new THREE.InstancedMesh(geo, makeMat(makeTex(true)), nFlower + 20);
        place(flowers, nFlower, 3, 58, 0.55, 0.9, [0.2, 0.15, 0.97]);
        [grass, flowers].forEach(m => { m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false; this.scene.add(m); });
    }

    createTree(x, z, type = null, rand = null) {
        const SM = window.SurveyModels;
        const r = rand || SM.rng(Math.floor(Math.abs(x * 73.1 + z * 19.7)) + 1);
        const t = type || (r() > 0.5 ? 'broad' : 'conifer');
        const parts = [];
        const s = 0.85 + r() * 0.35;
        if (t === 'conifer') SM.coniferParts(r, s, parts); else SM.broadleafParts(r, s, parts);
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(SM.mergeColored(parts), SM.M.vertexFlat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        group.position.set(x, this.heightAt(x, z) - 0.05, z);
        group.rotation.y = r() * Math.PI * 2;
        group.userData.treeType = t;
        this.scene.add(group);
        this.trees.push(group);
        return group;
    }

    createMonument(x, y, z, labelText) {
        const group = new THREE.Group();
        group.position.set(x, y, z);
        window.SurveyModels.buildMonument(group, labelText);

        group.userData = {
            type: 'monument',
            label: labelText,
            name: labelText,
            x: x, y: y, z: z
        };

        this.scene.add(group);
        this.interactiveObjects.push(group);
        this.benchmarks.push(group);

        // Permanent floating arrow for control point visibility
        this.createFloatingHintArrow(x, z, labelText, 0xf59e0b, false);

        return group;
    }

    /**
     * Creates an active 2.4m ground setup zone ONLY at the specific station the player currently needs to go to.
     * @param {number} x X coordinate
     * @param {number} z Z coordinate
     * @param {string} labelText Station label
     * @param {boolean} isTemporaryStation If true (like Level 2 Auto-Level station), no concrete monument is built
     */
    createStationSetupZone(x, z, labelText, isTemporaryStation = false) {
        const SM = window.SurveyModels;
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        if (!this._padTex) {
            this._padTex = SM.canvasTex(512, 512, (ctx, w, h) => {
                ctx.clearRect(0, 0, w, h);
                const c = w / 2;
                // 半透明深色測站墊
                ctx.fillStyle = 'rgba(15,23,42,0.55)';
                ctx.beginPath(); ctx.arc(c, c, 250, 0, Math.PI * 2); ctx.fill();
                // 黃黑警示斜紋外環
                ctx.save();
                ctx.beginPath(); ctx.arc(c, c, 252, 0, Math.PI * 2); ctx.arc(c, c, 226, 0, Math.PI * 2, true); ctx.clip();
                ctx.fillStyle = '#f5b301'; ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#111827';
                for (let i = -w; i < w * 2; i += 36) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 18, 0); ctx.lineTo(i + 18 - h, h); ctx.lineTo(i - h, h); ctx.fill(); }
                ctx.restore();
                // 內圈刻度
                ctx.strokeStyle = 'rgba(250,204,21,0.8)'; ctx.lineWidth = 3;
                for (let i = 0; i < 72; i++) {
                    const a = i / 72 * Math.PI * 2, l = i % 6 === 0 ? 18 : 8;
                    ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * 222, c + Math.sin(a) * 222); ctx.lineTo(c + Math.cos(a) * (222 - l), c + Math.sin(a) * (222 - l)); ctx.stroke();
                }
                // 中心十字
                ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(c - 40, c); ctx.lineTo(c + 40, c); ctx.moveTo(c, c - 40); ctx.lineTo(c, c + 40); ctx.stroke();
            });
        }
        const padGeo = new THREE.CircleGeometry(1.22, 48);
        padGeo.rotateX(-Math.PI / 2);
        const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({
            map: this._padTex, transparent: true, roughness: 0.7, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
        }));
        pad.position.y = 0.015;
        pad.receiveShadow = true;
        pad.renderOrder = 2;
        group.add(pad);

        // 三腳架腳位導引 (3 yellow foot markers)
        for (let i = 0; i < 3; i++) {
            const angle = (i * Math.PI * 2) / 3 + Math.PI / 2;
            const dotGeo = new THREE.RingGeometry(0.06, 0.12, 24);
            dotGeo.rotateX(-Math.PI / 2);
            const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
            dot.position.set(Math.cos(angle) * 0.62, 0.02, Math.sin(angle) * 0.62);
            group.add(dot);
        }

        // 臨時測站：紅頭測釘 (no concrete monument)
        if (isTemporaryStation) {
            const peg = new THREE.Mesh(SM.lathe([[0, 0], [0.035, 0], [0.04, 0.01], [0.03, 0.02], [0, 0.022]], 20), SM.M.red);
            peg.position.y = 0.012;
            peg.castShadow = true;
            group.add(peg);
            this.createFloatingHintArrow(x, z, labelText, 0x06b6d4, true);
        }

        group.userData = {
            type: 'monument',
            label: labelText,
            name: labelText,
            isTemporary: isTemporaryStation,
            x: x, y: 0, z: z
        };

        this.scene.add(group);
        this.interactiveObjects.push(group);
        this.stationPads.push(group);

        return group;
    }

    createTripodWithInstrument(x, z, instrumentType = 'gnss') {
        const { group, head, tribrach, accessories } = window.SurveyModels.buildInstrumentStation(instrumentType);
        group.position.set(x, 0, z);
        group.rotation.y = 0;

        group.userData = {
            type: 'instrument',
            instrumentType: instrumentType,
            isLeveled: false,
            isCentered: false,
            height: 1.52,
            head: head,
            tribrach: tribrach,
            accessories: accessories
        };

        this.scene.add(group);
        this.interactiveObjects.push(group);
        this.tripods.push(group);
        return group;
    }

    /** 將儀器頭 (望遠鏡 +Z) 轉向指定的世界座標點 */
    aimInstrument(group, tx, tz) {
        if (!group || !group.userData || !group.userData.head) return;
        const dx = tx - group.position.x, dz = tz - group.position.z;
        group.userData.head.rotation.y = Math.atan2(dx, dz) - group.rotation.y;
    }

    createLevelStaff(x, z, height = 3.0) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        // 3m Telescopic Aluminum Level Rod
        const rodGeo = new THREE.BoxGeometry(0.10, height, 0.04);

        // Generate Ultra-Sharp High-Resolution E-pattern Texture (256x2048)
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 2048;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 256, 2048);

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, 256, 2048);

        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(80, 0);
        ctx.lineTo(80, 2048);
        ctx.stroke();

        const totalDm = 30; // 3.0 meters = 30 decimeters
        const pxPerDm = 2048 / totalDm;
        const pxPerCm = pxPerDm / 10;

        for (let dm = 0; dm < totalDm; dm++) {
            const meterIdx = Math.floor(dm / 10);
            const themeColor = (meterIdx % 2 === 1) ? '#dc2626' : '#0f172a';
            const dmBottomY = 2048 - (dm * pxPerDm);
            const dmTopY = dmBottomY - pxPerDm;

            ctx.fillStyle = themeColor;
            ctx.font = 'bold 36px "Consolas", "Roboto Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const dmLabel = dm.toString().padStart(2, '0');
            ctx.fillText(dmLabel, 40, (dmTopY + dmBottomY) / 2);

            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, dmBottomY);
            ctx.lineTo(80, dmBottomY);
            ctx.stroke();

            if (dm % 10 === 0) {
                ctx.fillStyle = '#f59e0b';
                ctx.fillRect(4, dmBottomY - 24, 28, 22);
                ctx.fillStyle = '#000000';
                ctx.font = 'bold 16px sans-serif';
                ctx.fillText(`${meterIdx}m`, 18, dmBottomY - 13);
            }

            // Right Lane: Standard Precision E-Pattern (10 cm blocks)
            ctx.fillStyle = themeColor;
            const E = [[80, 170], [80, 50], [80, 120], [80, 50], [80, 170], [80, 170], [190, 60], [140, 110], [190, 60], [80, 170]];
            for (let k = 0; k < 10; k++) {
                const cmBottomY = dmBottomY - (k * pxPerCm);
                const cmTopY = cmBottomY - pxPerCm;
                ctx.fillRect(E[k][0], cmTopY, E[k][1], cmBottomY - cmTopY);
            }
        }

        const staffTex = new THREE.CanvasTexture(canvas);
        staffTex.generateMipmaps = true;
        staffTex.minFilter = THREE.LinearMipmapLinearFilter;
        staffTex.magFilter = THREE.LinearFilter;
        staffTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        staffTex.needsUpdate = true;

        const sideMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.35, metalness: 0.6 });
        const faceMat = new THREE.MeshStandardMaterial({ map: staffTex, roughness: 0.45 });

        // Materials: +X, -X, +Y, -Y, +Z (Front), -Z (Back)
        const staffMat = [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat];

        const rod = new THREE.Mesh(rodGeo, staffMat);
        rod.position.y = height / 2;
        rod.castShadow = true;
        rod.receiveShadow = true;
        group.add(rod);
        window.SurveyModels.decorateLevelStaff(group, height);

        group.userData = {
            type: 'level_staff',
            rodHeight: 1.485, // true reading value
            tiltAngle: 0.03, // small tilt needs correcting by assistant
            isBubbleCentered: false
        };

        this.scene.add(group);
        this.interactiveObjects.push(group);
        this.levelStaffs.push(group);
        return group;
    }

    createPrismTarget(x, z) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        window.SurveyModels.buildPrismPole(group, 1.8);

        group.userData = {
            type: 'prism',
            name: 'Prism-Point-01',
            height: 1.8
        };

        this.scene.add(group);
        this.interactiveObjects.push(group);

        this.createFloatingHintArrow(x, z, "稜鏡目標點 (Prism-01)", 0x06b6d4, true);

        return group;
    }

    createGCPTarget(x, z, label = "GCP-01", customCanvas = null) {
        const SM = window.SurveyModels;
        // Remove previous temporary setup pad at this spot if exists
        if (this.stationPads) {
            const padIdx = this.stationPads.findIndex(p => Math.hypot(p.position.x - x, p.position.z - z) < 1.0);
            if (padIdx > -1) {
                const oldPad = this.stationPads[padIdx];
                this.scene.remove(oldPad);
                const intIdx = this.interactiveObjects.indexOf(oldPad);
                if (intIdx > -1) this.interactiveObjects.splice(intIdx, 1);
                this.stationPads.splice(padIdx, 1);
            }
        }

        const group = new THREE.Group();
        group.position.set(x, 0.02, z);

        // 1.2m x 1.2m Aerial Photo Target (painted on the ground)
        const size = 1.2;
        const targetGeo = new THREE.PlaneGeometry(size, size);
        targetGeo.rotateX(-Math.PI / 2);

        let tex;
        if (customCanvas) {
            tex = new THREE.CanvasTexture(customCanvas);
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 256, 256);
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, 128, 128);
            ctx.fillRect(128, 128, 128, 128);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(128, 0); ctx.lineTo(128, 256);
            ctx.moveTo(0, 128); ctx.lineTo(256, 128);
            ctx.stroke();
            tex = new THREE.CanvasTexture(canvas);
        }
        tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        tex.needsUpdate = true;

        const targetMat = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.85,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.05,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
        });
        const mesh = new THREE.Mesh(targetGeo, targetMat);
        mesh.receiveShadow = true;
        group.add(mesh);

        // 測量鋼釘 (survey nail + washer)
        const nail = new THREE.Mesh(SM.lathe([[0, 0], [0.03, 0], [0.032, 0.006], [0.012, 0.01], [0.01, 0.022], [0, 0.026]], 20), SM.M.brass);
        nail.position.y = 0.0;
        nail.castShadow = true;
        group.add(nail);

        // Large invisible hitbox cylinder for easy crosshair raycasting
        const hitGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.5, 16);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitbox = new THREE.Mesh(hitGeo, hitMat);
        hitbox.position.y = 0.25;
        group.add(hitbox);

        group.userData = {
            type: 'gcp',
            label: label,
            captured: false,
            x: x, y: 0, z: z
        };

        this.scene.add(group);
        this.interactiveObjects.push(group);
        this.gcpMarkers.push(group);

        this.createFloatingHintArrow(x, z, `航測標誌 [${label}]`, 0xef4444, true);

        return group;
    }

    createFloatingHintArrow(x, z, labelText, color = 0xf59e0b, isDynamic = false) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        const hex = `#${color.toString(16).padStart(6, '0')}`;

        // 1. 立體箭頭 (shaft + head, lathe)
        const arrowGeo = window.SurveyModels.lathe([[0, 0], [0.34, 0.42], [0.14, 0.42], [0.14, 0.95], [0, 0.95]], 24);
        const arrowMat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.6,
            roughness: 0.25,
            metalness: 0.3
        });
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.position.y = 3.2;
        group.add(arrow);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        orb.position.y = 1.08;
        arrow.add(orb);

        // 2. High-Visibility Floating 2D Canvas Billboard Badge
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 140;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(8, 8, 496, 124, 20);
            ctx.fill();
            ctx.lineWidth = 6;
            ctx.strokeStyle = hex;
            ctx.stroke();
        } else {
            ctx.fillRect(8, 8, 496, 124);
        }
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px "Segoe UI", "Microsoft JhengHei", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`📍 ${labelText}`, 256, 70);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.y = 4.4;
        sprite.scale.set(3.4, 0.95, 1);
        sprite.renderOrder = 10;
        group.add(sprite);

        // 3. Ground Pulse Ring
        const ringGeo = new THREE.RingGeometry(0.35, 0.5, 40);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true, opacity: 0.75, depthWrite: false });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.y = 0.05;
        group.add(ring);

        // 4. Vertical Beacon Light Beam (soft additive)
        const beamGeo = new THREE.CylinderGeometry(0.03, 0.06, 3.2, 12, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = 1.6;
        group.add(beam);

        group.userData = {
            label: labelText,
            baseY: 3.2,
            offset: Math.random() * Math.PI * 2,
            arrowMesh: arrow,
            ringMesh: ring,
            spriteMesh: sprite,
            isDynamic: isDynamic
        };

        this.scene.add(group);
        this.floatingArrows.push(group);
        if (isDynamic) {
            this.dynamicArrows.push(group);
        }
        return group;
    }

    /**
     * Controls the visibility of 3D floating markers/arrows so ONLY the points needed for the current active task are shown.
     * @param {string[]|string|null} allowedKeywords Array of point label keywords to display, '*' to show all, or null/[] to hide all.
     */
    setVisibleFloatingPoints(allowedKeywords) {
        if (!this.floatingArrows) return;
        if (allowedKeywords === '*' || (Array.isArray(allowedKeywords) && allowedKeywords.includes('*'))) {
            this.floatingArrows.forEach(g => g.visible = true);
            return;
        }
        if (!allowedKeywords || (Array.isArray(allowedKeywords) && allowedKeywords.length === 0)) {
            this.floatingArrows.forEach(g => g.visible = false);
            return;
        }

        const keywords = Array.isArray(allowedKeywords) ? allowedKeywords : [allowedKeywords];
        this.floatingArrows.forEach(g => {
            const lbl = (g.userData && g.userData.label) ? g.userData.label : '';
            const isMatch = keywords.some(kw => lbl.toLowerCase().includes(kw.toLowerCase()));
            g.visible = isMatch;
        });
    }

    createUAVDrone() {
        if (this.droneModel) {
            this.scene.remove(this.droneModel);
            this.droneModel = null;
        }
        const { group, propellers } = window.SurveyModels.buildDrone();
        // 無人機放在 layer 1：FPV 時主攝影機不渲染 (避免穿模)，但仍投射陰影；第三人稱時再開啟
        group.traverse(o => o.layers.set(1));
        group.position.set(0, 0.5, 0);
        this.scene.add(group);
        this.droneModel = group;
        // 起降墊覆蓋於原點控制點上方：飛行關卡暫時隱藏該樁位，避免與機身穿插
        this.benchmarks.forEach(b => { if (Math.hypot(b.position.x, b.position.z) < 1.5) b.visible = false; });
        this.propellers = propellers;
        return group;
    }

    updateDronePropellers(delta) {
        if (!this.propellers || this.propellers.length === 0) return;
        this.propellers.forEach((prop, i) => {
            prop.rotation.y += (i % 2 === 0 ? 1 : -1) * delta * 45;
            if (prop.userData.disc) prop.userData.disc.material.opacity = 0.16;
        });
    }

    updateAnimations(delta) {
        this.animTime += delta;

        this.floatingArrows.forEach(g => {
            if (!g.userData) return;
            const newY = g.userData.baseY + Math.sin(this.animTime * 3.5 + g.userData.offset) * 0.25;
            if (g.userData.arrowMesh) {
                g.userData.arrowMesh.position.y = newY;
                g.userData.arrowMesh.rotation.y += delta * 2.2;
            }
            if (g.userData.spriteMesh) {
                g.userData.spriteMesh.position.y = newY + 1.2;
            }
            if (g.userData.ringMesh) {
                const scale = 1.0 + Math.sin(this.animTime * 4.0 + g.userData.offset) * 0.25;
                g.userData.ringMesh.scale.set(scale, scale, scale);
            }
        });

        if (this.grassUniforms) {
            this.grassUniforms.uTime.value = this.animTime;
            this.updatePaveMask();
        }
        this.clouds.forEach(c => {
            c.position.x += delta * c.userData.drift;
            if (c.position.x > 900) c.position.x = -900;
        });
    }

    /** 收集目前所有鋪面 (圓形近似)，傳給草叢 shader */
    updatePaveMask() {
        const list = [];
        const add = (o, r) => {
            if (!o || !o.parent || o.visible === false || list.length >= 24) return;
            o.getWorldPosition(this._tmpV || (this._tmpV = new THREE.Vector3()));
            list.push([this._tmpV.x, this._tmpV.z, r]);
        };
        (this.stationPads || []).forEach(p => add(p, 1.25));
        (this.gcpMarkers || []).forEach(g => add(g, 0.88));
        this.benchmarks.forEach(b => add(b, 0.45));
        this.paveExtra = this.paveExtra.filter(e => e.obj.parent);
        this.paveExtra.forEach(e => add(e.obj, e.r));
        const arr = this.grassUniforms.uPave.value;
        list.forEach((c, i) => arr[i].set(c[0], c[1], c[2], 0));
        this.grassUniforms.uPaveN.value = list.length;
    }

    /** 讓其他模組登記額外鋪面 (例如無人機起降墊) */
    addPavement(obj, r) {
        this.paveExtra.push({ obj, r });
    }

    clearDynamicProps() {
        // Clear previous level tripods, staffs, markers, active station setup pads, drone
        this.tripods.forEach(t => this.scene.remove(t));
        this.levelStaffs.forEach(s => this.scene.remove(s));
        this.gcpMarkers.forEach(g => this.scene.remove(g));
        if (this.stationPads) {
            this.stationPads.forEach(p => this.scene.remove(p));
            this.stationPads = [];
        }
        this.dynamicArrows.forEach(a => {
            this.scene.remove(a);
            const idx = this.floatingArrows.indexOf(a);
            if (idx > -1) this.floatingArrows.splice(idx, 1);
        });
        if (this.droneModel) {
            this.scene.remove(this.droneModel);
            this.droneModel = null;
            this.propellers = [];
        }
        this.benchmarks.forEach(b => { b.visible = true; });
        this.tripods = [];
        this.levelStaffs = [];
        this.gcpMarkers = [];
        this.dynamicArrows = [];
        this.interactiveObjects = [...this.benchmarks];
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        const now = performance.now();
        const delta = Math.min(0.05, (now - this._lastRender) / 1000);
        this._lastRender = now;
        this.updateAnimations(delta);

        // 天空跟隨相機；陰影視錐跟隨玩家 (以 2m 網格吸附避免陰影閃爍)
        const cp = this.camera.position;
        this.sky.position.copy(cp);
        if (this.sunLight) {
            const tx = Math.round(cp.x / 2) * 2, tz = Math.round(cp.z / 2) * 2;
            this.sunLight.target.position.set(tx, 0, tz);
            this.sunLight.position.set(tx + this.sunDir.x * 120, this.sunDir.y * 120, tz + this.sunDir.z * 120);
        }
        this.renderer.render(this.scene, this.camera);
    }
}

window.SurveyScene = SurveyScene;
