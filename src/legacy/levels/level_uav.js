/**
 * Level 4: 無人機 UAV 航拍攝影測量 (UAV Photogrammetry Survey)
 * 
 * 任務流程：
 * 步驟 0：啟動無人機起飛並攀升至 20m 作業航高
 * 步驟 1：依序巡航 WP-01 -> WP-02 -> WP-03 -> WP-04，沿途航拍正射影像 (涵蓋地面航測標)
 * 步驟 2：安全返航並精準降落於地面停機坪 (Home Pad)，綜合結算全關成績！
 * 
 * 評分維度 (四大向度計分，各佔 25%)：
 * 1. 航線走廊符合度 (25%)：水平航向軌跡與規劃航帶重合度 (要求偏差 <= 1.5m)
 * 2. 作業航高符合度 (25%)：作業高度維持於 20.0m 穩定度 (要求高程波動 <= 0.8m，以維持 GSD 解析度)
 * 3. 航拍照相品質評分 (25%)：每張航拍照片針對「地面航測標居中度 (50%)」、「曝光航高精確度 (35%)」、「曝光平穩度 (15%)」即時打分
 * 4. 停機坪著陸精度 (25%)：返航降落於停機坪中央 H 標記之精確度 (要求偏差 <= 0.5m)
 */
class LevelUAV {
    constructor(gameApp) {
        this.app = gameApp;
        this.id = 'uav';
        this.title = '關卡 4: 無人機航拍攝影測量';
        this.currentStep = 0;

        this.photoCount = 0;
        this.targetPhotos = 4;
        this.altitude = 1.8;
        this.flightAlt = 20.0;
        this.battery = 98;
        this.homePos = new THREE.Vector3(0, 0, 0);

        // 4 大航點坐標與對應地面標誌
        this.waypoints = [
            { id: 1, pos: new THREE.Vector3(-15, 20, -15), groundPos: new THREE.Vector3(-15, 0, -15), name: 'WP-01 (西北角)', label: 'WP-01', visited: false },
            { id: 2, pos: new THREE.Vector3(15, 20, -15), groundPos: new THREE.Vector3(15, 0, -15), name: 'WP-02 (東北角)', label: 'WP-02', visited: false },
            { id: 3, pos: new THREE.Vector3(15, 20, 15), groundPos: new THREE.Vector3(15, 0, 15), name: 'WP-03 (東南角)', label: 'WP-03', visited: false },
            { id: 4, pos: new THREE.Vector3(-15, 20, 15), groundPos: new THREE.Vector3(-15, 0, 15), name: 'WP-04 (西南角)', label: 'WP-04', visited: false }
        ];

        this.currentWPIndex = 0;
        this.waypointMarkers = [];
        this.flightPathObjects = [];

        // 採樣遙測數據與照片打分
        this.routeComplianceSamples = [];
        this.altComplianceSamples = [];
        this.altitudeSamples = [];
        this.photoScores = [];
        this.photoDetails = [];
        this.gcpCapturesCount = 0;
        this.landingScore = 100;
        this.landingDistError = 0;
        this.emergencyTriggered = false;
        this.hasTakenOff = false;
        this.animTime = 0;
    }

    getTasks() {
        return [
            { id: 0, text: "按 E 鍵啟動無人機起飛並攀升至 20m 設計作業航高" },
            { id: 1, text: "依光柱指引依序巡航 WP-01 ~ WP-04 航拍正射影像 (按空白鍵 Space 拍照)" },
            { id: 2, text: "操縱無人機安全返航並精準降落於起降場 (Home 點)" }
        ];
    }

    getInteractionPrompt(obj) {
        return null;
    }

    start() {
        this.app.sceneManager.clearDynamicProps();

        // Reset state for clean replay
        this.currentStep = 0;
        this.currentWPIndex = 0;
        this.photoCount = 0;
        this.battery = 100;
        this.hasTakenOff = false;
        this.routeComplianceSamples = [];
        this.altComplianceSamples = [];
        this.altitudeSamples = [];
        this.photoScores = [];
        this.photoDetails = [];
        this.gcpCapturesCount = 0;
        this.landingScore = 100;
        this.landingDistError = 0;
        this.emergencyTriggered = false;
        this.app.player.isEmergencyLanding = false;

        // Reset waypoint visited status
        this.waypoints.forEach(wp => wp.visited = false);

        // Hide all ground monument floating arrows for UAV mode
        this.app.sceneManager.setVisibleFloatingPoints([]);

        // 2. Spawn 4 GCP Ground Targets under WP-01 ~ WP-04
        const sharedCanvas = this.app.savedGCPCanvas || window.savedGCPCanvas || null;
        this.waypoints.forEach(wp => {
            this.app.sceneManager.createGCPTarget(
                wp.groundPos.x, 
                wp.groundPos.z, 
                `GCP-0${wp.id}`, 
                sharedCanvas
            );
        });

        // 3. Create 3D High-Visibility Airborne Light Pillars, Glowing Rings, and Flight Corridor
        this.create3DFlightPath();

        // 1. Spawn Home Landing Pad on Ground at (0, 0)
        //    (須在 create3DFlightPath 之後建立，否則會被 clearFlightPathObjects 一併移除)
        this.createLandingPad(0, 0);
        this.refreshAllWaypointVisuals();

        // 4. Spawn UAV Drone Model in Scene
        this.app.sceneManager.createUAVDrone();

        // 5. Put Player into Drone FPV Mode at Ground Level (0, 0.45, 0)
        this.app.player.setDroneMode(true, new THREE.Vector3(0, 0.45, 0));

        // 6. Show Drone HUD
        const hud = document.getElementById('drone-hud');
        if (hud) hud.classList.add('active');

        const emergAlert = document.getElementById('drone-emergency-alert');
        if (emergAlert) emergAlert.style.display = 'none';

        const shutterPrompt = document.getElementById('drone-space-shutter-prompt');
        if (shutterPrompt) shutterPrompt.style.display = 'none';

        const countElem = document.getElementById('drone-photo-count');
        const targetWp = document.getElementById('drone-target-wp');
        const batElem = document.getElementById('drone-bat');
        if (countElem) countElem.innerText = `0 / ${this.targetPhotos}`;
        if (targetWp) targetWp.innerText = 'WP-01';
        if (batElem) batElem.innerText = '100%';

        this.app.updateMissionPanel(
            this.title, 
            this.getTasks(), 
            this.currentStep, 
            "無人機待機中。按住 E 鍵攀升油門起飛至 20m 設計作業航高 (起飛後開始扣電量)。"
        );

        // Hook Shutter Button
        const shutterBtn = document.getElementById('drone-shutter-btn');
        if (shutterBtn) {
            shutterBtn.onclick = () => this.onDroneShutter();
        }

        // Open Flight Operation Briefing Modal
        this.openBriefingModal();
    }

    openBriefingModal() {
        if (document.exitPointerLock) document.exitPointerLock();
        const modal = document.getElementById('uav-briefing-modal');
        if (modal) {
            modal.classList.add('show');
            const btnStart = document.getElementById('btn-start-uav-flight');
            if (btnStart) {
                btnStart.onclick = () => {
                    modal.classList.remove('show');
                };
            }
        }
    }

    createLandingPad(x, z) {
        const group = new THREE.Group();
        group.position.set(x, 0.02, z);

        // 圓形折疊式起降墊 (foldable landing pad)
        const padGeo = new THREE.CircleGeometry(1.75, 56);
        padGeo.rotateX(-Math.PI / 2);

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f26b0f';
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath(); ctx.arc(256, 256, 200, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#f26b0f'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(256, 256, 180, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 260px "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', 256, 268);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 26px sans-serif';
        for (let i = 0; i < 4; i++) {
            ctx.save(); ctx.translate(256, 256); ctx.rotate(i * Math.PI / 2);
            ctx.fillText('HOME', 0, -226); ctx.restore();
        }

        const tex = new THREE.CanvasTexture(canvas);
        const padMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
        const pad = new THREE.Mesh(padGeo, padMat);
        group.add(pad);

        // Vertical Home Landing Pillar (active during Step 2)
        const beamGeo = new THREE.CylinderGeometry(1.2, 1.2, 20, 16);
        beamGeo.translate(0, 10, 0);
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0x10b981,
            transparent: true,
            opacity: 0.65,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const homeBeacon = new THREE.Mesh(beamGeo, beamMat);
        homeBeacon.visible = false;
        group.add(homeBeacon);
        this.homeBeacon = homeBeacon;

        // Floating Text Billboard for Home Pad
        const homeSprite = this.createTextSprite('🏠 停機坪 (Home)', 'active');
        homeSprite.position.set(0, 22, 0);
        homeSprite.visible = false;
        group.add(homeSprite);
        this.homeSprite = homeSprite;

        this.app.sceneManager.scene.add(group);
        this.flightPathObjects.push(group);
        if (this.app.sceneManager.addPavement) this.app.sceneManager.addPavement(group, 1.8);
    }

    // =========================================================================
    // 在空中生成超顯眼 3D 發光航線、雙層通天光柱與航點全像門
    // =========================================================================
    create3DFlightPath() {
        this.clearFlightPathObjects();
        const alt = this.flightAlt;

        // 1. Semi-transparent Glowing Tube / Corridor in Sky
        const points = [
            new THREE.Vector3(-15, alt, -15),
            new THREE.Vector3(15, alt, -15),
            new THREE.Vector3(15, alt, 15),
            new THREE.Vector3(-15, alt, 15),
            new THREE.Vector3(-15, alt, -15)
        ];

        const pathCurve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.1);
        const tubeGeo = new THREE.TubeGeometry(pathCurve, 64, 0.28, 8, false);
        const tubeMat = new THREE.MeshBasicMaterial({
            color: 0x10b981,
            transparent: true,
            opacity: 0.45
        });
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        this.app.sceneManager.scene.add(tube);
        this.flightPathObjects.push(tube);

        // 2. High-Visibility Waypoint Gates with Double Laser Columns & Dynamic Billboards
        this.waypoints.forEach((wp, idx) => {
            const wpGroup = new THREE.Group();
            wpGroup.position.set(wp.pos.x, 0, wp.pos.z);

            // (A) Outer Glow Laser Pillar (Cylinder radius 1.2m)
            const outerBeamGeo = new THREE.CylinderGeometry(1.2, 1.2, alt, 16);
            outerBeamGeo.translate(0, alt / 2, 0);
            const outerBeamMat = new THREE.MeshBasicMaterial({
                color: idx === 0 ? 0xfbbf24 : 0x0284c7,
                transparent: true,
                opacity: idx === 0 ? 0.65 : 0.12,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const outerBeamMesh = new THREE.Mesh(outerBeamGeo, outerBeamMat);
            wpGroup.add(outerBeamMesh);

            // (B) Inner Intense Core Laser Beam (Cylinder radius 0.35m)
            const innerBeamGeo = new THREE.CylinderGeometry(0.35, 0.35, alt, 12);
            innerBeamGeo.translate(0, alt / 2, 0);
            const innerBeamMat = new THREE.MeshBasicMaterial({
                color: idx === 0 ? 0xffffff : 0x0284c7,
                transparent: true,
                opacity: idx === 0 ? 0.9 : 0.2,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const innerBeamMesh = new THREE.Mesh(innerBeamGeo, innerBeamMat);
            wpGroup.add(innerBeamMesh);

            // (C) Airborne Rotating Torus Rings
            const ringOuterMat = new THREE.MeshBasicMaterial({
                color: idx === 0 ? 0xf59e0b : 0x0284c7,
                transparent: true,
                opacity: idx === 0 ? 1.0 : 0.35
            });
            const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.18, 8, 32), ringOuterMat);
            ringOuter.position.y = alt;
            ringOuter.rotation.x = Math.PI / 2;
            wpGroup.add(ringOuter);

            const ringInnerMat = new THREE.MeshBasicMaterial({
                color: idx === 0 ? 0xfde047 : 0x38bdf8,
                transparent: true,
                opacity: idx === 0 ? 1.0 : 0.4
            });
            const ringInner = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.14, 8, 24), ringInnerMat);
            ringInner.position.y = alt;
            ringInner.rotation.x = Math.PI / 2;
            wpGroup.add(ringInner);

            // (D) Floating 3D Text Billboard
            const textSprite = this.createTextSprite(wp.label, idx === 0 ? 'active' : 'pending');
            textSprite.position.set(0, alt + 4.2, 0);
            wpGroup.add(textSprite);

            this.app.sceneManager.scene.add(wpGroup);
            this.flightPathObjects.push(wpGroup);

            this.waypointMarkers.push({
                group: wpGroup,
                outerBeamMat: outerBeamMat,
                innerBeamMat: innerBeamMat,
                ringOuter: ringOuter,
                ringOuterMat: ringOuterMat,
                ringInner: ringInner,
                ringInnerMat: ringInnerMat,
                textSprite: textSprite,
                wp: wp
            });
        });

        // 3. Ground Projected Footprint Guide
        const groundRectGeo = new THREE.PlaneGeometry(30, 30);
        groundRectGeo.rotateX(-Math.PI / 2);
        const groundRectMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide
        });
        const groundRect = new THREE.Mesh(groundRectGeo, groundRectMat);
        groundRect.position.set(0, 0.03, 0);
        this.app.sceneManager.scene.add(groundRect);
        this.flightPathObjects.push(groundRect);
    }

    refreshAllWaypointVisuals() {
        // Only show the active waypoint for the current mission step!
        this.waypointMarkers.forEach((m, idx) => {
            const isTarget = (idx === this.currentWPIndex && this.currentStep < 2);

            if (isTarget) {
                // ACTIVE TARGET ONLY: Visible with Blazing Golden Yellow / Amber
                m.group.visible = true;
                m.outerBeamMat.color.setHex(0xfbbf24);
                m.outerBeamMat.opacity = 0.70;
                m.innerBeamMat.color.setHex(0xffffff);
                m.innerBeamMat.opacity = 0.95;
                m.ringOuterMat.color.setHex(0xf59e0b);
                m.ringOuterMat.opacity = 1.0;
                m.ringInnerMat.color.setHex(0xfde047);
                m.ringInnerMat.opacity = 1.0;
                this.updateTextSprite(m.textSprite, `👉 【 ${m.wp.label} 】 👈`, 'active');
            } else {
                // HIDE all other waypoints that are not the current active task!
                m.group.visible = false;
            }
        });

        // If returning to Home (Step 2), show ONLY Home Pad landing beacon
        if (this.currentStep === 2) {
            if (this.homeBeacon) this.homeBeacon.visible = true;
            if (this.homeSprite) this.homeSprite.visible = true;
        } else {
            if (this.homeBeacon) this.homeBeacon.visible = false;
            if (this.homeSprite) this.homeSprite.visible = false;
        }
    }

    createTextSprite(text, status = 'active') {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 120;
        this.renderBadgeCanvas(canvas, text, status);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(7.5, 2.8, 1);
        sprite.userData = { canvas: canvas, tex: tex };
        return sprite;
    }

    updateTextSprite(sprite, text, status) {
        if (!sprite || !sprite.userData || !sprite.userData.canvas) return;
        const canvas = sprite.userData.canvas;
        this.renderBadgeCanvas(canvas, text, status);
        sprite.userData.tex.needsUpdate = true;
    }

    renderBadgeCanvas(canvas, text, status) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (status === 'active') {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.95)';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 6;
            ctx.roundRect(10, 10, w - 20, h - 20, 20);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#000000';
            ctx.font = '900 38px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, w / 2, h / 2);
        } else if (status === 'completed') {
            ctx.fillStyle = 'rgba(5, 150, 105, 0.88)';
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 4;
            ctx.roundRect(10, 10, w - 20, h - 20, 20);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, w / 2, h / 2);
        } else {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = 3;
            ctx.roundRect(10, 10, w - 20, h - 20, 20);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 30px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, w / 2, h / 2);
        }
    }

    clearFlightPathObjects() {
        this.flightPathObjects.forEach(obj => {
            this.app.sceneManager.scene.remove(obj);
        });
        this.flightPathObjects = [];
        this.waypointMarkers = [];
    }

    // =========================================================================
    // 航拍快門與單張照片品質評分 (Shutter & Photo Scoring System)
    // =========================================================================
    onDroneShutter() {
        if (window.surveyAudio) window.surveyAudio.playCameraShutter();

        // Shutter screen flash
        const flash = document.createElement('div');
        flash.style.position = 'fixed';
        flash.style.inset = '0';
        flash.style.backgroundColor = 'rgba(255, 255, 255, 0.75)';
        flash.style.zIndex = '9999';
        flash.style.pointerEvents = 'none';
        flash.style.transition = 'opacity 0.2s';
        document.body.appendChild(flash);
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 200);
        }, 50);

        this.photoCount++;
        const countEl = document.getElementById('drone-photo-count');
        if (countEl) countEl.innerText = `${Math.min(this.targetPhotos, this.photoCount)} / ${this.targetPhotos}`;

        const dronePos = this.app.player.dronePosition;
        const currentWP = this.waypoints[this.currentWPIndex];

        // 檢查相機鏡頭是否朝向地面俯拍 (Nadir Downward Gimbal Check)
        const camDir = this.app.player.getDroneCameraDirection
            ? this.app.player.getDroneCameraDirection()
            : this.app.player.camera.getWorldDirection(new THREE.Vector3());
        const isLookingDown = camDir.y < -0.20;

        // 1. 地面航測標居中度打分 (Target Centering Score: 50%)
        let targetGround = currentWP ? currentWP.groundPos : new THREE.Vector3(-15, 0, -15);
        const centerDist = new THREE.Vector2(dronePos.x, dronePos.z).distanceTo(new THREE.Vector2(targetGround.x, targetGround.z));
        
        let centeringScore = 100;
        if (!isLookingDown) {
            // 未向下俯拍，鏡頭未拍到地面 GCP
            centeringScore = 30;
        } else {
            if (centerDist <= 2.5) {
                centeringScore = 100;
            } else if (centerDist <= 5.0) {
                centeringScore = 90;
            } else if (centerDist <= 8.0) {
                centeringScore = 80;
            } else if (centerDist <= 12.0) {
                centeringScore = 65;
            } else {
                centeringScore = 40;
            }
        }

        // 2. 曝光航高穩定度打分 (Exposure Altitude Score: 35%)
        const altError = Math.abs(this.altitude - this.flightAlt);
        let altScore = 100;
        if (altError <= 0.5) {
            altScore = 100;
        } else if (altError <= 1.2) {
            altScore = 90;
        } else if (altError <= 2.5) {
            altScore = 75;
        } else {
            altScore = 50;
        }

        // 3. 飛行平穩度打分 (Speed & Vibration Score: 15%)
        const spd = this.app.player.droneSpeed || 5.0;
        let speedScore = spd <= 4.5 ? 100 : (spd <= 6.5 ? 90 : 70);

        // 單張照片綜合品質得分
        const singlePhotoScore = Math.round(centeringScore * 0.50 + altScore * 0.35 + speedScore * 0.15);
        this.photoScores.push(singlePhotoScore);
        this.photoDetails.push({
            wpName: currentWP ? currentWP.label : `WP-0${this.photoCount}`,
            score: singlePhotoScore,
            centerDist: isLookingDown ? `${centerDist.toFixed(1)}m` : '未對地拍攝',
            alt: `${this.altitude.toFixed(1)}m`
        });

        if (isLookingDown && centerDist <= 14.0) {
            this.gcpCapturesCount++;
        }

        // 顯示拍照即時得分浮動橫幅 (Toast)
        this.showPhotoScoreToast(this.photoCount, singlePhotoScore, centeringScore, altScore, isLookingDown);

        // Check distance to active waypoint & advance
        if (currentWP) {
            currentWP.visited = true;
            this.currentWPIndex++;

            this.refreshAllWaypointVisuals();

            if (this.currentWPIndex < this.waypoints.length) {
                const nextWP = this.waypoints[this.currentWPIndex];
                this.currentStep = 1;
                const wpTargetEl = document.getElementById('drone-target-wp');
                if (wpTargetEl) wpTargetEl.innerText = nextWP.label;

                this.app.updateMissionPanel(
                    this.title, 
                    this.getTasks(), 
                    this.currentStep, 
                    `第 ${this.photoCount} 組航拍完成 [照片得分: ${singlePhotoScore}分]！跟隨黃色發光光柱繼續飛往 ${nextWP.name} (請保持鏡頭對地俯拍)。`
                );
            } else {
                // All 4 photos taken -> Return to Home
                this.currentStep = 2;
                this.refreshAllWaypointVisuals(); // Hides WP01~04 and activates Home landing beacon!
                const wpTargetEl = document.getElementById('drone-target-wp');
                if (wpTargetEl) wpTargetEl.innerText = '🏠 返航起降場';

                if (window.surveyAudio) window.surveyAudio.playSuccessChime();
                this.app.updateMissionPanel(
                    this.title, 
                    this.getTasks(), 
                    this.currentStep, 
                    `所有 4 組航測照片已全數採集！請操縱無人機返航並精準降落於起降場 (Home Pad) 中央 H 標記。`
                );
            }
        }
    }

    showPhotoScoreToast(photoNum, totalScore, centerScore, altScore, isLookingDown = true) {
        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.bottom = '90px';
        toast.style.right = '30px';
        toast.style.background = 'rgba(15, 23, 42, 0.95)';
        toast.style.border = `2px solid ${isLookingDown ? '#10b981' : '#f59e0b'}`;
        toast.style.boxShadow = `0 0 25px ${isLookingDown ? 'rgba(16, 185, 129, 0.5)' : 'rgba(245, 158, 11, 0.5)'}`;
        toast.style.borderRadius = '12px';
        toast.style.padding = '12px 20px';
        toast.style.color = '#fff';
        toast.style.zIndex = '9999';
        toast.style.fontSize = '14px';
        toast.style.pointerEvents = 'none';
        toast.style.transition = 'all 0.3s ease';

        toast.innerHTML = `
            <div style="font-weight:700; color:${isLookingDown ? '#34d399' : '#facc15'}; font-size:16px; margin-bottom:4px; display:flex; justify-content:space-between; gap:20px;">
                <span>📷 航拍照片 #${photoNum} 評分</span>
                <span style="color:#facc15; font-size:18px;">${totalScore} 分</span>
            </div>
            <div style="font-size:12px; color:#cbd5e1; line-height:1.5;">
                🎯 對地 GCP 居中: <strong style="color:#38bdf8;">${centerScore}分</strong> | 📐 航高精度: <strong style="color:#38bdf8;">${altScore}分</strong>
                ${!isLookingDown ? '<div style="color:#f87171; font-weight:700; margin-top:3px;">⚠️ 提醒：鏡頭未朝下對地俯拍，未拍到地面 GCP 航測標！</div>' : '<div style="color:#34d399; font-weight:700; margin-top:3px;">✓ 成功對地俯拍地面 GCP 航測標！</div>'}
            </div>
        `;

        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => toast.remove(), 300);
        }, 2400);
    }


    /**
     * Calculates shortest 2D horizontal distance from point P to line segment A-B
     */
    getPointToSegmentDistance2D(px, pz, ax, az, bx, bz) {
        const l2 = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
        if (l2 === 0) return Math.hypot(px - ax, pz - az);
        let t = ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projX = ax + t * (bx - ax);
        const projZ = az + t * (bz - az);
        return Math.hypot(px - projX, pz - projZ);
    }

    update(delta) {
        if (!this.app.player.isDroneMode) return;

        this.animTime += delta;
        const pos = this.app.player.dronePosition;
        const cam = this.app.player.camera;
        this.altitude = pos.y;
        this.altitudeSamples.push(this.altitude);

        // Detect First Takeoff (Stationary until player initiates climb with E)
        if (!this.hasTakenOff) {
            if (this.app.player.keys.droneUp || pos.y > 0.8 || this.app.player.droneSpeed > 0.5) {
                this.hasTakenOff = true;
                this.currentStep = 1;
                this.app.updateMissionPanel(
                    this.title,
                    this.getTasks(),
                    this.currentStep,
                    "無人機已升空！按住 E 鍵攀升至 20m 設計作業航高，依序飛往 WP-01 (抵達航點請按空白鍵 Space 拍照)。"
                );
            }
        }

        // Battery Consumption (~1.25% per second during active flight, 0% while stationary before takeoff)
        if (this.hasTakenOff) {
            const isMoving = this.app.player.droneSpeed > 0.5 || Math.abs(pos.y - 1.8) > 0.5;
            const drainRate = isMoving ? 1.25 : 0.45;
            this.battery = Math.max(0, this.battery - delta * drainRate);
        } else {
            this.battery = 100.0;
        }

        // Requirement: When battery < 20%, trigger auto-emergency forced descent!
        const emergAlert = document.getElementById('drone-emergency-alert');
        if (this.battery <= 20.0) {
            if (!this.emergencyTriggered) {
                this.emergencyTriggered = true;
                this.app.player.isEmergencyLanding = true;
                if (window.surveyAudio) window.surveyAudio.playClick();
            }
            if (emergAlert) emergAlert.style.display = 'block';

            const guideEl = document.getElementById('drone-control-guide');
            if (guideEl) {
                guideEl.innerHTML = "<span style='color:#f87171; font-weight:700;'>🚨 強制迫降中 (垂直油門已鎖定)！[W/S/A/D] 水平平移對準起降場 Home 點</span>";
            }
        } else {
            if (emergAlert) emergAlert.style.display = 'none';
        }

        // Animate Waypoints: rotate rings & pulse active target waypoint's golden beam
        this.waypointMarkers.forEach((m, idx) => {
            if (m.ringOuter) m.ringOuter.rotation.z += delta * 0.8;
            if (m.ringInner) m.ringInner.rotation.z -= delta * 1.2;

            if (idx === this.currentWPIndex) {
                const pulse = Math.sin(this.animTime * 6);
                m.outerBeamMat.opacity = 0.55 + pulse * 0.25;
                m.innerBeamMat.opacity = 0.80 + pulse * 0.18;
                const scale = 1.0 + pulse * 0.12;
                m.ringOuter.scale.set(scale, scale, scale);
                m.ringInner.scale.set(scale, scale, scale);
            }
        });

        // Determine current active target 3D point
        let target3D = null;
        let targetLabel = '';
        if (this.currentWPIndex < this.waypoints.length) {
            const activeWP = this.waypoints[this.currentWPIndex];
            target3D = activeWP.pos;
            targetLabel = activeWP.label;
        } else {
            target3D = new THREE.Vector3(0, 0.5, 0);
            targetLabel = '起降場 (Home 點)';
        }

        const distToTarget = pos.distanceTo(target3D);
        const distToHome = new THREE.Vector2(pos.x, pos.z).distanceTo(new THREE.Vector2(0, 0));

        // Prompt to press SPACE for taking aerial photo when close to target waypoint
        const shutterPrompt = document.getElementById('drone-space-shutter-prompt');
        const isNearActiveWaypoint = (this.currentWPIndex < this.waypoints.length && distToTarget <= 14.0);

        if (shutterPrompt) {
            if (isNearActiveWaypoint) {
                shutterPrompt.style.display = 'block';
                shutterPrompt.innerHTML = `📷 已抵達【 ${targetLabel} 】上空！請按 <span style="background:#facc15; color:#000; padding:2px 8px; border-radius:4px; margin:0 4px; font-weight:900;">空白鍵 Space</span> 進行航拍攝影！`;
            } else {
                shutterPrompt.style.display = 'none';
            }
        }

        // Update Navigational Guidance UI Box
        const navText = document.getElementById('drone-nav-text');
        const navArrow = document.getElementById('drone-nav-arrow');
        const wpMarkerEl = document.getElementById('drone-waypoint-marker');
        const wpMarkerLabel = document.getElementById('drone-marker-label');

        // Calculate heading relative to drone camera
        const toTarget = new THREE.Vector3().subVectors(target3D, cam.position).normalize();
        const camForward = new THREE.Vector3();
        cam.getWorldDirection(camForward);
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);

        const dotFwd = camForward.dot(toTarget);
        const dotRight = camRight.dot(toTarget);

        let arrowChar = '⬆️';
        if (dotFwd > 0.6) {
            arrowChar = '⬆️ 正前方';
        } else if (dotRight > 0.3) {
            arrowChar = '➡️ 右側';
        } else if (dotRight < -0.3) {
            arrowChar = '⬅️ 左側';
        } else {
            arrowChar = '⬇️ 後方';
        }

        if (navArrow) navArrow.innerText = arrowChar;
        if (navText) {
            if (this.currentWPIndex < this.waypoints.length) {
                if (isNearActiveWaypoint) {
                    navText.innerHTML = `📷 已抵達【 <span style="color:#facc15;">${targetLabel}</span> 】！請按【 空白鍵 Space 】拍照！`;
                } else {
                    navText.innerText = `飛往目標航點：【 ${targetLabel} 】 距離 ${distToTarget.toFixed(1)} m (抵達後按 Space 拍照)`;
                }
            } else {
                navText.innerText = `目標航點：【 起降場 (Home 點) 】 距離 ${distToHome.toFixed(1)} m (降落於中央 H 標記)`;
            }
        }

        // Screen-space 3D Waypoint Tracker Marker
        if (wpMarkerEl && target3D) {
            const screenPos = target3D.clone().project(cam);
            const isBehind = screenPos.z > 1.0 || dotFwd < 0.2;

            if (!isBehind && Math.abs(screenPos.x) <= 0.95 && Math.abs(screenPos.y) <= 0.95) {
                const screenX = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
                const screenY = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;
                wpMarkerEl.style.display = 'block';
                wpMarkerEl.style.left = `${screenX}px`;
                wpMarkerEl.style.top = `${screenY}px`;
                if (wpMarkerLabel) wpMarkerLabel.innerText = `🎯 ${targetLabel} [${distToTarget.toFixed(0)}m]`;
            } else {
                wpMarkerEl.style.display = 'none';
            }
        }

        // =====================================================================
        // 1. 航線走廊符合度 (Route Compliance Evaluation)
        // =====================================================================
        let prevX = 0, prevZ = 0;
        let currX = 0, currZ = 0;

        if (this.currentWPIndex === 0) {
            prevX = 0; prevZ = 0;
            currX = this.waypoints[0].pos.x; currZ = this.waypoints[0].pos.z;
        } else if (this.currentWPIndex < this.waypoints.length) {
            const prevWP = this.waypoints[this.currentWPIndex - 1];
            const currWP = this.waypoints[this.currentWPIndex];
            prevX = prevWP.pos.x; prevZ = prevWP.pos.z;
            currX = currWP.pos.x; currZ = currWP.pos.z;
        } else {
            const prevWP = this.waypoints[this.waypoints.length - 1];
            prevX = prevWP.pos.x; prevZ = prevWP.pos.z;
            currX = 0; currZ = 0;
        }

        const hDistToRoute = this.getPointToSegmentDistance2D(pos.x, pos.z, prevX, prevZ, currX, currZ);
        const routeCompliance = Math.max(30, Math.min(100, Math.round(100 - Math.max(0, hDistToRoute - 1.5) * 10)));
        
        if (this.currentStep === 1) {
            this.routeComplianceSamples.push(routeCompliance);
        }

        // =====================================================================
        // 2. 作業航高符合度 (Altitude Compliance Evaluation)
        // =====================================================================
        const altError = Math.abs(this.altitude - this.flightAlt);
        const altCompliance = Math.max(20, Math.min(100, Math.round(100 - Math.max(0, altError - 0.8) * 16)));
        
        if (this.currentStep === 1) {
            this.altComplianceSamples.push(altCompliance);
        }

        // Update HUD Telemetry
        const altEl = document.getElementById('drone-alt');
        const spdEl = document.getElementById('drone-spd');
        const batEl = document.getElementById('drone-bat');
        const routeCompEl = document.getElementById('drone-route-compliance');
        const altCompEl = document.getElementById('drone-alt-compliance');
        const homeEl = document.getElementById('drone-dist-home');

        if (altEl) altEl.innerText = `${this.altitude.toFixed(1)} m`;
        if (spdEl) spdEl.innerText = `${(this.app.player.droneSpeed).toFixed(1)} m/s`;
        if (batEl) {
            batEl.innerText = `${Math.round(this.battery)}%`;
            batEl.style.color = this.battery <= 20 ? '#ef4444' : '#10b981';
        }
        if (routeCompEl) {
            routeCompEl.innerText = `${routeCompliance}%`;
            routeCompEl.style.color = routeCompliance >= 85 ? '#10b981' : '#f59e0b';
        }
        if (altCompEl) {
            altCompEl.innerText = `${altCompliance}%`;
            altCompEl.style.color = altCompliance >= 85 ? '#10b981' : '#f59e0b';
        }
        if (homeEl) homeEl.innerText = `${distToHome.toFixed(1)} m`;

        // Check Takeoff Altitude (>= 18m)
        if (this.currentStep === 0 && this.altitude >= 18.0) {
            this.currentStep = 1;
            this.app.updateMissionPanel(
                this.title, 
                this.getTasks(), 
                this.currentStep, 
                "已達 20m 作業航高！請保持航高與航線穩定，飛往 WP-01 並按空白鍵拍照。"
            );
        }

        // Landing Precision Check on Home Pad
        if (this.currentStep === 2 || this.emergencyTriggered) {
            if (this.altitude <= 1.95) {
                this.landingDistError = distToHome;

                if (distToHome <= 0.5) {
                    this.landingScore = 100;
                } else if (distToHome <= 1.2) {
                    this.landingScore = 90;
                } else if (distToHome <= 2.2) {
                    this.landingScore = 75;
                } else if (distToHome <= 3.5) {
                    this.landingScore = 55;
                } else {
                    this.landingScore = 30;
                }

                this.finishLevel();
            }
        }
    }

    finishLevel() {
        this.app.player.isEmergencyLanding = false;
        this.app.player.setDroneMode(false);
        const hud = document.getElementById('drone-hud');
        if (hud) hud.classList.remove('active');
        this.clearFlightPathObjects();

        if (window.surveyAudio) window.surveyAudio.playSuccessChime();

        // 1. Route Compliance Score (25%)
        const avgRouteCompliance = this.routeComplianceSamples.length > 0 
            ? Math.round(this.routeComplianceSamples.reduce((a, b) => a + b, 0) / this.routeComplianceSamples.length)
            : 90;

        // 2. Altitude Compliance Score (25%)
        const avgAltCompliance = this.altComplianceSamples.length > 0 
            ? Math.round(this.altComplianceSamples.reduce((a, b) => a + b, 0) / this.altComplianceSamples.length)
            : 90;

        // 3. Photo Quality Score (25%)
        const avgPhotoScore = this.photoScores.length > 0
            ? Math.round(this.photoScores.reduce((a, b) => a + b, 0) / this.photoScores.length)
            : 85;

        // 4. Landing Precision Score (25%)
        const landingFinalScore = this.landingScore;

        // Total 4-Factor Weighted Score
        const totalScore = Math.round(
            avgRouteCompliance * 0.25 + 
            avgAltCompliance * 0.25 + 
            avgPhotoScore * 0.25 + 
            landingFinalScore * 0.25
        );

        let rank = 'S';
        if (totalScore >= 92) rank = 'S';
        else if (totalScore >= 80) rank = 'A';
        else if (totalScore >= 65) rank = 'B';
        else if (totalScore >= 50) rank = 'C';
        else rank = 'F';

        // Calculate average cruise altitude
        const avgCruiseAlt = this.altitudeSamples.length > 0
            ? (this.altitudeSamples.reduce((a, b) => a + b, 0) / this.altitudeSamples.length).toFixed(1)
            : '20.0';

        const customTargetMsg = (this.app.savedGCPCanvas || window.savedGCPCanvas) 
            ? '✓ 成功套用第 3 關手繪自定義航測標誌' 
            : '使用標準黑白棋盤航測標誌';

        const photoDetailSummary = this.photoDetails.map((p, i) => `#${i+1} (${p.wpName}): ${p.score}分`).join(' | ');

        this.app.completeLevel(this.id, {
            score: totalScore,
            rank: rank,
            details: [
                { label: '1. 航線走廊依循吻合度 (25%)', value: `軌跡吻合度: ${avgRouteCompliance}% [得分: ${avgRouteCompliance} 分]` },
                { label: '2. 作業航高穩定吻合度 (25%)', value: `航高吻合度: ${avgAltCompliance}% (平均航高: ${avgCruiseAlt}m) [得分: ${avgAltCompliance} 分]` },
                { label: '3. 航拍照相曝光品質 (25%)', value: `均分: ${avgPhotoScore} 分 [${photoDetailSummary}]` },
                { label: '4. 起降場 (Home 點) 著陸精度 (25%)', value: `著陸偏差: ${this.landingDistError.toFixed(2)}m [得分: ${landingFinalScore} 分]` },
                { label: '地面航測標誌圖樣來源', value: customTargetMsg },
                { label: '外業電量管理與迫降狀態', value: `${Math.round(this.battery)}% (${this.emergencyTriggered ? '觸發低電量強制迫降' : '正常返航降落'})` },
                { label: '無人機航拍攝影綜合評分', value: `${totalScore} 分 (評等: ${rank})` }
            ]
        });
    }
}

window.LevelUAV = LevelUAV;
