/**
 * Level 2: 精密水準測量 (Leveling Survey) - 自主選點與前後視距平衡版
 * 
 * 任務流程：
 * 步驟 0：自主選定測站：在 BM-01 與 BM-02 之間自由走動選點，按 E 架設水準儀（系統根據前後視距平衡度評分）
 * 步驟 1：望遠鏡觀測後視 BM-01 水準尺，調焦與扶尺自由操作並讀數（不設門檻，開放評分）
 * 步驟 2：前往前視 BM-02 水準尺處，擔任扶尺員進行標尺圓氣泡平衡整平 (WASD 平穩微調)
 * 步驟 3：開啟水準計算面板，依公式 Δh = 後視 - 前視 使用鍵盤計算輸入高程差，完成通關結算！
 */
class LevelLeveling {
    constructor(gameApp) {
        this.app = gameApp;
        this.id = 'leveling';
        this.title = '關卡 2: 精密水準測量';
        this.currentStep = 0;

        this.levelMesh = null;
        this.staffBackMesh = null;
        this.staffForeMesh = null;

        // 基準點已知坐標 (BM-01 & BM-02)
        this.bm1X = 10;
        this.bm1Z = -10;
        this.bm2X = 22;
        this.bm2Z = -28;

        // 觀測基準真值
        this.backsight = 1.485;
        this.foresight = 0.835;

        // 自主選點架站位置與視距幾何
        this.setupX = 16;
        this.setupZ = -19;
        this.distBack = 10.82;
        this.distFore = 10.82;
        this.distDiff = 0.00;
        this.stadiaScore = 100;

        // 望遠鏡調焦與讀數狀態
        this.focusValue = 0.3; // 0.1 ~ 1.0 (最佳為 ~0.85)
        this.rodBubbleHolding = 0.25; // -0.4 ~ +0.4 (最佳為 0.0)
        this.backsightFocusScore = null;
        this.backsightTiltScore = null;

        // 扶尺平衡整平狀態
        this.staffBalancingActive = false;
        this.bubbleX = 16;
        this.bubbleY = -12;
        this.velocityX = 0;
        this.velocityY = 0;
        this.balanceTimeLeft = 8.0;
        this.balanceTotalDuration = 8.0;
        this.balanceInterval = null;
        this.staffStabilityScore = 100;
        this.sampleTicks = 0;
        this.totalQuality = 0;

        // 高差計算鍵盤輸入
        this.userCalculatedDeltaH = null;
        this.mathScore = null;
    }

    getTasks() {
        return [
            { id: 0, text: "在水準點 BM-01 與 BM-02 之間自主選站架設水準儀 (檢核前後視距等長)" },
            { id: 1, text: "望遠鏡照準後視水準標尺 BM-01，物鏡調焦消除視差並讀取中絲讀數" },
            { id: 2, text: "前往前視水準點 BM-02 擔任扶尺員，維持標尺圓水準氣泡鉛垂整平" },
            { id: 3, text: "鍵盤輸入計算兩點高程差 Δh = 後視讀數 a - 前視讀數 b" }
        ];
    }

    getFreeInteractPrompt(playerPos) {
        if (this.currentStep === 0) {
            const d1 = Math.hypot(playerPos.x - this.bm1X, playerPos.z - this.bm1Z);
            const d2 = Math.hypot(playerPos.x - this.bm2X, playerPos.z - this.bm2Z);
            const diff = Math.abs(d1 - d2);
            return `在此位置架設水準儀 [後視距 ${d1.toFixed(1)}m | 前視距 ${d2.toFixed(1)}m | 視距差 ${diff.toFixed(2)}m]`;
        }
        if (this.currentStep === 3) {
            return "打開水準高差外業計算面板 [計算 Δh = a - b]";
        }
        return null;
    }

    onFreeInteract(playerPos) {
        if (this.currentStep === 0) {
            const px = parseFloat(playerPos.x.toFixed(2));
            const pz = parseFloat(playerPos.z.toFixed(2));

            this.setupX = px;
            this.setupZ = pz;
            this.distBack = parseFloat(Math.hypot(px - this.bm1X, pz - this.bm1Z).toFixed(2));
            this.distFore = parseFloat(Math.hypot(px - this.bm2X, pz - this.bm2Z).toFixed(2));
            this.distDiff = parseFloat(Math.abs(this.distBack - this.distFore).toFixed(2));

            // Evaluate Stadia Distance Balance Score (前後視距等長平衡評分)
            // Engineering standard: <= 0.5m -> 100, <= 1.5m -> 90~70, <= 4.0m -> 70~40
            if (this.distDiff <= 0.5) {
                this.stadiaScore = 100;
            } else if (this.distDiff <= 1.5) {
                this.stadiaScore = Math.max(70, Math.round(100 - (this.distDiff - 0.5) * 30));
            } else if (this.distDiff <= 4.0) {
                this.stadiaScore = Math.max(40, Math.round(70 - (this.distDiff - 1.5) * 12));
            } else {
                this.stadiaScore = Math.max(10, Math.round(40 - (this.distDiff - 4.0) * 5));
            }

            // Create Auto-Level at player's chosen location
            this.levelMesh = this.app.sceneManager.createTripodWithInstrument(px, pz, 'level');
            // 望遠鏡先照準後視標尺 BM-01
            this.app.sceneManager.aimInstrument(this.levelMesh, this.bm1X, this.bm1Z);
            // Create station pad under the newly placed level
            this.app.sceneManager.createStationSetupZone(px, pz, "水準儀測站", true);

            if (window.surveyAudio) window.surveyAudio.playClick();

            this.currentStep = 1;
            // Step 1: Highlight the newly placed LEVEL INSTRUMENT station (Hide BM-01 & BM-02)
            this.app.sceneManager.setVisibleFloatingPoints(['水準儀測站', '水準儀']);

            const diffDesc = this.distDiff <= 0.5 ? "極佳！符合一等精密水準前後視距等長規範" : `視距差 ${this.distDiff}m`;
            this.app.updateMissionPanel(
                this.title, 
                this.getTasks(), 
                this.currentStep, 
                `水準儀已架設於 (${px}, ${pz})！後視距 ${this.distBack}m / 前視距 ${this.distFore}m (${diffDesc})。請靠近水準儀按 E 進行後視望遠鏡調焦與讀數。`
            );
        } else if (this.currentStep === 3) {
            this.openCalculationModal();
        }
    }

    getInteractionPrompt(obj) {
        const type = obj.userData ? obj.userData.type : null;
        if (type === 'instrument' && obj.userData.instrumentType === 'level') {
            if (this.currentStep === 1) return "望遠鏡目鏡調焦並觀測後視 BM-01 [水準儀]";
            if (this.currentStep === 3) return "打開水準高差計算面板 [計算 Δh = a - b]";
        }
        if (type === 'level_staff') {
            if (this.currentStep === 2 && (obj.userData.staffType === 'fore' || obj === this.staffForeMesh)) {
                return "扶正前視 BM-02 水準尺圓氣泡 [標尺整平]";
            }
            if (this.currentStep === 3) return "打開水準高差計算面板 [計算 Δh = a - b]";
        }
        return null;
    }

    start() {
        this.app.sceneManager.clearDynamicProps();

        // Spawn player in the midway corridor between BM-01 and BM-02
        this.app.player.position.set(16, 1.65, -14);
        this.app.player.euler.set(0, -Math.PI / 4, 0);
        this.app.player.camera.position.copy(this.app.player.position);
        this.app.player.camera.quaternion.setFromEuler(this.app.player.euler);

        // Reset all states for clean replay
        this.currentStep = 0;

        // Step 0: Player needs to find midway station, show BOTH BM-01 and BM-02 (Hide CKSV, etc.)
        this.app.sceneManager.setVisibleFloatingPoints(['BM-01', 'BM-02']);
        this.levelMesh = null;
        this.setupX = 16;
        this.setupZ = -19;
        this.distBack = 10.82;
        this.distFore = 10.82;
        this.distDiff = 0.00;
        this.stadiaScore = 100;
        this.focusValue = 0.3;
        this.rodBubbleHolding = 0.25;
        this.backsightFocusScore = null;
        this.backsightTiltScore = null;
        this.staffBalancingActive = false;
        this.staffStabilityScore = 100;
        this.userCalculatedDeltaH = null;
        this.mathScore = null;

        if (this.balanceInterval) {
            clearInterval(this.balanceInterval);
            this.balanceInterval = null;
        }

        // Place permanent benchmark rods on BM-01 (10, -10) and BM-02 (22, -28)
        this.staffBackMesh = this.app.sceneManager.createLevelStaff(this.bm1X, this.bm1Z, 3.0);
        this.staffForeMesh = this.app.sceneManager.createLevelStaff(this.bm2X, this.bm2Z, 3.0);
        this.staffBackMesh.userData.staffType = 'back';
        this.staffForeMesh.userData.staffType = 'fore';

        // Orient front E-pattern face directly towards midpoint survey station (16, 0, -19)
        this.staffBackMesh.lookAt(16, 0, -19);
        this.staffForeMesh.lookAt(16, 0, -19);

        this.app.updateMissionPanel(
            this.title, 
            this.getTasks(), 
            this.currentStep, 
            "自主選站：請在 BM-01 與 BM-02 之間走動選點，按 E 鍵在當前位置架設水準儀（系統將根據前後視距平衡度評分）。"
        );
    }

    onInteract(obj) {
        const type = obj.userData ? obj.userData.type : null;

        // Step 3: Calculation modal can be opened from anywhere by interacting
        if (this.currentStep === 3) {
            this.openCalculationModal();
            return;
        }

        // Step 1: Telescope backsight observation
        if (type === 'instrument' && obj.userData.instrumentType === 'level') {
            if (this.currentStep === 1) {
                this.openTelescopeOverlay('backsight');
            }
        }

        // Step 2: Foresight staff balancing at BM-02
        if (type === 'level_staff' || (type === 'monument' && obj.userData.label && obj.userData.label.includes('BM-02'))) {
            if (this.currentStep === 2) {
                this.openStaffBalancingModal();
            }
        }
    }

    // =========================================================================
    // 步驟 1：後視 BM-01 望遠鏡調焦與讀數 (不限制門檻，開放玩家自由確認並記錄殘差)
    // =========================================================================
    openTelescopeOverlay(phase) {
        if (document.exitPointerLock) document.exitPointerLock();
        const overlay = document.getElementById('telescope-overlay');
        if (!overlay) return;
        overlay.classList.add('active');

        document.getElementById('tele-target-label').innerText = `後視 BM-01 水準標尺 (後視距 ${this.distBack}m)`;

        // Render staff image on canvas
        this.renderStaffTelescopeView();

        const teleKeyHandler = (e) => {
            if (!overlay.classList.contains('active')) {
                window.removeEventListener('keydown', teleKeyHandler);
                return;
            }
            if (e.key === 'ArrowUp' || e.code === 'KeyW') {
                this.focusValue = Math.min(1.0, this.focusValue + 0.05);
                this.renderStaffTelescopeView();
            } else if (e.key === 'ArrowDown' || e.code === 'KeyS') {
                this.focusValue = Math.max(0.1, this.focusValue - 0.05);
                this.renderStaffTelescopeView();
            } else if (e.key === 'ArrowLeft' || e.code === 'KeyA') {
                this.rodBubbleHolding = Math.max(-0.4, this.rodBubbleHolding - 0.03);
                this.renderStaffTelescopeView();
            } else if (e.key === 'ArrowRight' || e.code === 'KeyD') {
                this.rodBubbleHolding = Math.min(0.4, this.rodBubbleHolding + 0.03);
                this.renderStaffTelescopeView();
            } else if (e.key === 'Enter' || e.code === 'Space') {
                window.confirmStaffReading();
            }
        };
        window.addEventListener('keydown', teleKeyHandler);

        window.onTeleFocusChange = (val) => {
            this.focusValue = parseFloat(val);
            this.renderStaffTelescopeView();
        };

        window.onStaffBubbleAdjust = (val) => {
            this.rodBubbleHolding = parseFloat(val);
            this.renderStaffTelescopeView();
        };

        window.confirmStaffReading = () => {
            window.removeEventListener('keydown', teleKeyHandler);
            overlay.classList.remove('active');
            if (window.surveyAudio) window.surveyAudio.playSuccessChime();

            // Calculate player's focus & bubble holding score (0 ~ 100)
            const focusErr = Math.abs(this.focusValue - 0.85);
            const tiltErr = Math.abs(this.rodBubbleHolding);

            this.backsightFocusScore = Math.max(30, Math.round(100 - focusErr * 140));
            this.backsightTiltScore = Math.max(30, Math.round(100 - tiltErr * 220));

            // Advance to Step 2: Foresight Staff Bubble Balancing (Show ONLY BM-02, Hide BM-01)
            this.currentStep = 2;
            this.app.sceneManager.setVisibleFloatingPoints(['BM-02']);
            // 望遠鏡轉向前視標尺 BM-02
            if (this.levelMesh) this.app.sceneManager.aimInstrument(this.levelMesh, this.bm2X, this.bm2Z);

            this.app.updateMissionPanel(
                this.title, 
                this.getTasks(), 
                this.currentStep, 
                `後視 BM-01 讀數 a = ${this.backsight.toFixed(3)}m 已記錄！請走向前視 BM-02 水準尺處按 E 擔任扶尺員執行標尺鉛垂氣泡整平。`
            );
        };
    }

    renderStaffTelescopeView() {
        const canvas = document.getElementById('telescope-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = 600;
        const h = canvas.height = 600;

        // Sky & Ground background
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#7dd3fc');
        bgGrad.addColorStop(0.48, '#bae6fd');
        bgGrad.addColorStop(0.50, '#4ade80');
        bgGrad.addColorStop(1, '#166534');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Draw level rod
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(this.rodBubbleHolding * 0.22);

        // Rod body (Authentic 140px wide Aluminum Survey Staff)
        const rodW = 140;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-rodW / 2, -h, rodW, h * 2);

        // Rod borders and divider line
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.strokeRect(-rodW / 2, -h, rodW, h * 2);

        // Vertical lane divider between left (Decimeter digits) and right (E-Pattern)
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-15, -h);
        ctx.lineTo(-15, h * 2);
        ctx.stroke();

        // Target reading: a = 1.485m (Centered at crosshair y = 0)
        const targetReading = this.backsight;
        const scalePxPerMeter = 600; // 1m = 600px, 1dm = 60px, 1cm = 6px, 1mm = 0.6px

        for (let c = 0; c <= 300; c++) {
            const val = c * 0.01;
            const yTop = (targetReading - (val + 0.01)) * scalePxPerMeter;
            const yBottom = (targetReading - val) * scalePxPerMeter;
            const blockH = yBottom - yTop; // 6px

            // Skip rendering if offscreen
            if (yBottom < -h || yTop > h) continue;

            const m = Math.floor(c / 100);
            const dm = Math.floor(c / 10);
            const k = c % 10;
            // 1m range is vibrant red, 0m and 2m are black
            const themeColor = (m % 2 === 1) ? '#dc2626' : '#0f172a';

            // 1. Draw decimeter number in Left Lane (centered vertically inside each 10cm band)
            if (k === 0) {
                const yDmTop = (targetReading - (val + 0.10)) * scalePxPerMeter;
                const dmText = dm.toString().padStart(2, '0');
                ctx.fillStyle = themeColor;
                ctx.font = 'bold 22px "Consolas", "Roboto Mono", monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(dmText, -42, (yDmTop + yBottom) / 2);

                // Thin decimeter baseline divider
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(-rodW / 2, yBottom);
                ctx.lineTo(-15, yBottom);
                ctx.stroke();
            }

            // Meter marker pill
            if (c % 100 === 0) {
                ctx.fillStyle = '#f59e0b';
                ctx.fillRect(-rodW / 2 + 2, yBottom - 16, 16, 16);
                ctx.fillStyle = '#000';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${m}m`, -rodW / 2 + 10, yBottom - 8);
            }

            // 2. Draw standard E-pattern in Right Lane (x = -15 to +60)
            ctx.fillStyle = themeColor;
            if (k === 0) {
                ctx.fillRect(-15, yTop, 75, blockH);
            } else if (k === 1) {
                ctx.fillRect(-15, yTop, 25, blockH);
            } else if (k === 2) {
                ctx.fillRect(-15, yTop, 55, blockH);
            } else if (k === 3) {
                ctx.fillRect(-15, yTop, 25, blockH);
            } else if (k === 4) {
                ctx.fillRect(-15, yTop, 75, blockH);
            } else if (k === 5) {
                ctx.fillRect(-15, yTop, 75, blockH);
            } else if (k === 6) {
                ctx.fillRect(35, yTop, 25, blockH);
            } else if (k === 7) {
                ctx.fillRect(15, yTop, 45, blockH);
            } else if (k === 8) {
                ctx.fillRect(35, yTop, 25, blockH);
            } else if (k === 9) {
                ctx.fillRect(-15, yTop, 75, blockH);
            }
        }

        ctx.restore();

        // Assistant Rod Level Bubble indicator in corner
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.beginPath();
        ctx.arc(80, 80, 45, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.strokeStyle = '#eab308';
        ctx.beginPath();
        ctx.arc(80, 80, 14, 0, Math.PI * 2);
        ctx.stroke();

        const bubblePx = 80 + this.rodBubbleHolding * 120;
        ctx.fillStyle = Math.abs(this.rodBubbleHolding) <= 0.06 ? '#10b981' : '#f59e0b';
        ctx.beginPath();
        ctx.arc(bubblePx, 80, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText("標尺鉛垂氣泡", 80, 140);

        // Blur effect simulation via CSS filter for focus clarity
        const blurAmount = Math.max(0, (0.85 - this.focusValue) * 16);
        canvas.style.filter = `blur(${Math.abs(blurAmount)}px)`;
    }

    // =========================================================================
    // 步驟 2：前視 BM-02 扶尺員標尺氣泡平衡整平 (難度適中，WASD 平穩微調)
    // =========================================================================
    openStaffBalancingModal() {
        this.app.openModal('staff-qte-modal');

        this.bubbleX = 16;
        this.bubbleY = -12;
        this.velocityX = 0;
        this.velocityY = 0;
        this.balanceTimeLeft = 10.0;
        this.sampleTicks = 0;
        this.totalQuality = 0;
        this.staffBalancingActive = false;

        const timerEl = document.getElementById('staff-qte-timer');
        const timeBar = document.getElementById('staff-qte-time-bar');
        const stabEl = document.getElementById('staff-qte-stability');
        const resEl = document.getElementById('staff-qte-residual');
        const commentEl = document.getElementById('staff-qte-comment');
        const startBtn = document.getElementById('btn-start-staff-qte');

        if (timerEl) timerEl.innerText = "10.0 秒";
        if (timeBar) timeBar.style.width = "100%";
        if (stabEl) stabEl.innerText = "100.0%";
        if (resEl) resEl.innerText = "0.00 mm";
        if (commentEl) {
            commentEl.style.color = "#10b981";
            commentEl.innerText = "★ 準備開始！請輕按 [W/A/S/D] 或方向鍵施加推力使氣泡保持在綠色靶心內 ★";
        }
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.innerText = "▶ 幫我撐10秒 (Enter)";
            startBtn.focus();
        }

        this.updateStaffBubblePos();

        // Push force handlers
        window.triggerStaffPush = (dx, dy) => {
            if (!this.staffBalancingActive) return;
            this.velocityX += dx * 8.0;
            this.velocityY += dy * 8.0;
            if (window.surveyAudio) window.surveyAudio.playClick();
        };

        // Keyboard listener for balancing
        const balanceKeyHandler = (e) => {
            const modal = document.getElementById('staff-qte-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', balanceKeyHandler);
                return;
            }

            if (!this.staffBalancingActive && (e.key === 'Enter' || e.code === 'Space')) {
                window.startStaffQTE();
                return;
            }

            if (this.staffBalancingActive) {
                if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    window.triggerStaffPush(0, -1);
                } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    window.triggerStaffPush(0, 1);
                } else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    window.triggerStaffPush(-1, 0);
                } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    window.triggerStaffPush(1, 0);
                }
            }
        };
        window.addEventListener('keydown', balanceKeyHandler);

        window.startStaffQTE = () => {
            if (this.staffBalancingActive) return;
            this.staffBalancingActive = true;
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.innerText = "⚡ 扶尺維持觀測中 (輕按 WASD 微調平衡)...";
            }

            let simTime = 0;
            this.balanceInterval = setInterval(() => {
                simTime += 0.035;
                this.balanceTimeLeft = Math.max(0, this.balanceTimeLeft - 0.035);

                // Gentle natural breathing / air breeze wobble (speed 1.4, amplitude 0.45)
                const windX = Math.sin(simTime * 1.4) * 0.45 + Math.cos(simTime * 2.6) * 0.25;
                const windY = Math.cos(simTime * 1.2) * 0.45 + Math.sin(simTime * 2.3) * 0.25;

                this.velocityX += windX;
                this.velocityY += windY;

                // Position update with smooth natural damping
                this.bubbleX += this.velocityX;
                this.bubbleY += this.velocityY;
                this.velocityX *= 0.86;
                this.velocityY *= 0.86;

                // Clamp within vial bounds (radius 80px)
                const dist = Math.hypot(this.bubbleX, this.bubbleY);
                if (dist > 78) {
                    const angle = Math.atan2(this.bubbleY, this.bubbleX);
                    this.bubbleX = Math.cos(angle) * 78;
                    this.bubbleY = Math.sin(angle) * 78;
                }

                this.updateStaffBubblePos();

                // Evaluate quality at this tick (generous bullseye of 32px)
                let tickQuality = 0;
                if (dist <= 32) tickQuality = 100;
                else if (dist <= 55) tickQuality = 80;
                else if (dist <= 75) tickQuality = 50;
                else tickQuality = 20;

                this.sampleTicks++;
                this.totalQuality += tickQuality;
                const currentStability = (this.totalQuality / this.sampleTicks).toFixed(1);

                // UI Telemetry updates
                const pct = (this.balanceTimeLeft / this.balanceTotalDuration) * 100;
                if (timeBar) timeBar.style.width = `${pct}%`;
                if (timerEl) timerEl.innerText = `${this.balanceTimeLeft.toFixed(1)} 秒`;
                if (stabEl) stabEl.innerText = `${currentStability}%`;
                if (resEl) resEl.innerText = `${(dist * 0.012).toFixed(2)} mm`;

                if (commentEl) {
                    if (dist <= 32) {
                        commentEl.style.color = '#10b981';
                        commentEl.innerText = '★ 極佳！氣泡穩定位於一等水準靶心內 ★';
                    } else if (dist <= 55) {
                        commentEl.style.color = '#eab308';
                        commentEl.innerText = '⚡ 輕微偏心！請輕按 WASD 施加平穩反向推力 ⚡';
                    } else {
                        commentEl.style.color = '#ef4444';
                        commentEl.innerText = '⚠️ 氣泡晃動！請微調推力推回靶心 ⚠️';
                    }
                }

                // Finish balancing session
                if (this.balanceTimeLeft <= 0) {
                    clearInterval(this.balanceInterval);
                    this.balanceInterval = null;
                    this.staffBalancingActive = false;
                    window.removeEventListener('keydown', balanceKeyHandler);

                    this.staffStabilityScore = Math.min(100, Math.max(30, Math.round(this.totalQuality / this.sampleTicks)));
                    if (window.surveyAudio) window.surveyAudio.playSuccessChime();

                    if (commentEl) {
                        commentEl.style.color = '#10b981';
                        commentEl.innerText = `✓ 扶尺觀測完成！綜合鉛垂穩定度評分：${this.staffStabilityScore} 分！`;
                    }

                    setTimeout(() => {
                        this.app.closeModal('staff-qte-modal');
                        this.currentStep = 3;
                        this.app.sceneManager.setVisibleFloatingPoints([]);
                        this.app.updateMissionPanel(
                            this.title, 
                            this.getTasks(), 
                            this.currentStep, 
                            "前視扶尺整平完成！按 E 鍵隨時打開水準高差計算面板，計算兩點高程差 Δh。"
                        );
                        // Auto open calculation modal
                        setTimeout(() => this.openCalculationModal(), 400);
                    }, 1000);
                }
            }, 35);
        };
    }

    updateStaffBubblePos() {
        const bubble = document.getElementById('staff-qte-bubble');
        if (!bubble) return;
        bubble.style.transform = `translate(calc(-50% + ${this.bubbleX}px), calc(-50% + ${this.bubbleY}px))`;
    }

    // =========================================================================
    // 步驟 3：水準高差外業計算面板 (鍵盤自主輸入高程差 Δh，不洩漏提示答案)
    // =========================================================================
    openCalculationModal() {
        this.app.openModal('level-calc-modal');

        const deltaH = parseFloat((this.backsight - this.foresight).toFixed(3)); // +0.650m
        const backText = document.getElementById('calc-back-mid');
        const foreText = document.getElementById('calc-fore-mid');
        const inputEl = document.getElementById('calc-user-deltah');
        const feedbackEl = document.getElementById('calc-feedback-text');

        if (backText) backText.innerText = `${this.backsight.toFixed(3)} m (後視 BM-01, 視距 ${this.distBack}m)`;
        if (foreText) foreText.innerText = `${this.foresight.toFixed(3)} m (前視 BM-02, 視距 ${this.distFore}m)`;
        if (inputEl) {
            inputEl.value = '';
            setTimeout(() => inputEl.focus(), 150);
        }
        if (feedbackEl) feedbackEl.innerHTML = '';

        const calcKeyHandler = (e) => {
            const modal = document.getElementById('level-calc-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', calcKeyHandler);
                return;
            }
            if (e.key === 'Enter') {
                window.submitDeltaHCalculation();
            }
        };
        window.addEventListener('keydown', calcKeyHandler);

        window.submitDeltaHCalculation = () => {
            const userVal = parseFloat(inputEl.value);
            if (isNaN(userVal)) {
                if (feedbackEl) {
                    feedbackEl.innerHTML = `<span style="color:#ef4444;">⚠️ 請輸入計算所得的高程差數值（例如: 0.xxx）</span>`;
                }
                return;
            }

            this.userCalculatedDeltaH = userVal;
            const diff = Math.abs(userVal - deltaH);
            this.mathScore = diff <= 0.001 ? 100 : Math.max(0, Math.round(100 - diff * 250));

            window.removeEventListener('keydown', calcKeyHandler);

            if (feedbackEl) {
                if (diff <= 0.001) {
                    feedbackEl.innerHTML = `<span style="color:#10b981;">✓ 計算完全正確！Δh = ${userVal >= 0 ? '+' : ''}${userVal.toFixed(3)} m (得分: 100 分)</span>`;
                } else {
                    feedbackEl.innerHTML = `<span style="color:#ef4444;">⚠️ 計算存在偏差：輸入 ${userVal.toFixed(3)}m (真值應為 +${deltaH.toFixed(3)}m, 誤差: ${(diff * 1000).toFixed(1)}mm)</span>`;
                }
            }

            setTimeout(() => {
                this.app.closeModal('level-calc-modal');
                this.finishLevel();
            }, 1000);
        };
    }

    finishLevel() {
        if (window.surveyAudio) window.surveyAudio.playSuccessChime();

        const sScore = typeof this.stadiaScore === 'number' ? this.stadiaScore : 100;
        const fScore = this.backsightFocusScore || 90;
        const tScore = this.backsightTiltScore || 90;
        const qScore = this.staffStabilityScore || 95;
        const mScore = typeof this.mathScore === 'number' ? this.mathScore : 100;

        // 4-Factor Balanced Score:
        // 1. 架站前後視距等長平衡 (25%)
        // 2. 後視調焦清晰與讀數 (25%)
        // 3. 前視標尺鉛垂整平穩定率 (25%)
        // 4. 高差公式自主計算 (25%)
        const backsightCombined = Math.round(fScore * 0.5 + tScore * 0.5);
        const totalScore = Math.min(100, Math.max(0, Math.round(sScore * 0.25 + backsightCombined * 0.25 + qScore * 0.25 + mScore * 0.25)));

        let rank = 'S';
        if (totalScore >= 92) rank = 'S';
        else if (totalScore >= 80) rank = 'A';
        else if (totalScore >= 65) rank = 'B';
        else if (totalScore >= 50) rank = 'C';
        else rank = 'F';

        const trueDeltaH = (this.backsight - this.foresight).toFixed(3);
        const userDeltaHStr = typeof this.userCalculatedDeltaH === 'number' ? this.userCalculatedDeltaH.toFixed(3) : trueDeltaH;

        let stadiaDesc = this.distDiff <= 0.5 ? '一等水準標準 (極佳)' : (this.distDiff <= 1.5 ? '二等水準標準 (合格)' : '視距差偏大');

        this.app.completeLevel(this.id, {
            score: totalScore,
            rank: rank,
            details: [
                { label: '自主選點架站坐標', value: `(${this.setupX}, ${this.setupZ})` },
                { label: '前後視距平衡檢核', value: `後視 ${this.distBack}m / 前視 ${this.distFore}m [視距差 ${this.distDiff}m, ${stadiaDesc}, 得分: ${sScore}]` },
                { label: '後視 BM-01 望遠鏡調焦', value: `清晰度: ${fScore} 分 / 扶尺鉛垂: ${tScore} 分` },
                { label: '前視 BM-02 標尺氣泡整平', value: `鉛垂穩定率: ${qScore} 分 (風阻平衡檢定合格)` },
                { label: '高程差計算 Δh = a - b', value: `真值 +${trueDeltaH}m / 提交 ${userDeltaHStr}m [得分: ${mScore}]` },
                { label: '外業水準綜合評分', value: `${totalScore} 分 (評等: ${rank})` }
            ]
        });
    }
}

window.LevelLeveling = LevelLeveling;
