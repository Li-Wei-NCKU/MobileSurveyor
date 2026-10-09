/**
 * Level 1: GNSS 靜態測量 (GNSS Static Survey)
 * Mechanics: Tripod setup, bubble leveling, optical plummet centering, slant height measurement, static epoch tracking.
 */
class LevelGNSS {
    constructor(gameApp) {
        this.app = gameApp;
        this.id = 'gnss';
        this.title = '關卡 1: GNSS 靜態測量';
        this.currentStep = 0;
        this.tripodMesh = null;

        // Leveling state
        this.screwA = 0;
        this.screwB = 0;
        this.screwC = 0;
        this.shiftX = 0;
        this.shiftY = 0;
        this.activeTab = 'centering'; // Start with centering first

        this.bubbleX = 0.50;
        this.bubbleY = -0.42;
        this.centerX = 0.55;
        this.centerY = -0.45;

        this.isLeveled = false;
        this.isCentered = false;
        this.slantHeightMeasured = false;
        this.epochsRecorded = 0;
        this.targetEpochs = 1440;
    }

    getTasks() {
        return [
            { id: 0, text: "前往已知點 CKSV (一等衛星控制點) 並架設 GNSS 三腳架" },
            { id: 1, text: "進行三腳基座定心與定平 (光學對心器與圓水準氣泡交替微調至合格)" },
            { id: 2, text: "使用鋼捲尺量取天線儀器斜高 (Slant Antenna Height)" },
            { id: 3, text: "操作控制器啟動靜態測量" }
        ];
    }

    getInteractionPrompt(obj) {
        const type = obj.userData ? obj.userData.type : null;
        if (type === 'monument' && obj.userData.label && obj.userData.label.includes('CKSV')) {
            if (this.currentStep === 0) return "架設 GNSS 三腳架 [CKSV 一等控制點]";
        }
        if (type === 'instrument' && obj.userData.instrumentType === 'gnss') {
            if (this.currentStep === 1) return "進入基座定心與定平工作台 [GNSS]";
            if (this.currentStep === 2) return "量取天線儀器斜高 [鋼捲尺]";
            if (this.currentStep === 3) return "操作控制器啟動靜態測量 [GNSS Controller]";
        }
        return null;
    }

    start() {
        this.app.sceneManager.clearDynamicProps();
        this.app.player.position.set(0, 1.65, 3.5);
        this.app.player.euler.set(-0.12, 0, 0); // 面向 CKSV 控制點
        this.app.player.camera.position.copy(this.app.player.position);
        this.app.player.camera.quaternion.setFromEuler(this.app.player.euler);

        // Reset all step and measurement states for clean replay
        this.currentStep = 0;

        // Show ONLY CKSV control point floating marker for Level 1 (Hide BM-01, BM-02, etc.)
        this.app.sceneManager.setVisibleFloatingPoints(['CKSV', '一等衛星控制點']);
        this.tripodMesh = null;
        this.screwA = 0;
        this.screwB = 0;
        this.screwC = 0;
        this.shiftX = 0;
        this.shiftY = 0;
        this.activeTab = 'centering';
        this.isLeveled = false;
        this.isCentered = false;
        this.slantHeightMeasured = false;
        this.epochsRecorded = 0;
        this.finalCenteringErrorMm = null;
        this.finalLevelingErrorMm = null;
        this.tapeReadingErrorMm = null;
        this.playerInputSlantHeight = null;

        // Spawn dynamic 2.4m setup pad under target active monument CKSV
        this.app.sceneManager.createStationSetupZone(0, 0, "CKSV (一等衛星控制點)", false);

        this.app.updateMissionPanel(this.title, this.getTasks(), this.currentStep, "跟隨 3D 浮空箭頭前往 CKSV 一等衛星控制點，按 E 架設三腳架。");
    }

    onInteract(obj) {
        const type = obj.userData.type;

        if (this.currentStep === 0 && type === 'monument' && obj.userData.label.includes('CKSV')) {
            // Step 0: Setup tripod on CKSV
            this.tripodMesh = this.app.sceneManager.createTripodWithInstrument(obj.position.x, obj.position.z, 'gnss');
            if (window.surveyAudio) window.surveyAudio.playClick();
            this.currentStep = 1;
            this.app.updateMissionPanel(this.title, this.getTasks(), this.currentStep, "三腳架已架設於控制點上。靠近儀器按 E 進入基座定心與定平工作台。");
            return;
        }

        if (type === 'instrument' && obj.userData.instrumentType === 'gnss') {
            if (this.currentStep === 1) {
                this.openTribrachModal();
            } else if (this.currentStep === 2) {
                this.openTapeMeasureModal();
            } else if (this.currentStep === 3) {
                this.openGNSSControllerModal();
            }
        }
    }

    openTribrachModal() {
        this.app.openModal('leveling-modal');
        this.switchTab('centering');
        this.recalculateTribrachPhysics();

        // Keyboard handler for tribrach modal
        const modalKeyHandler = (e) => {
            const modal = document.getElementById('leveling-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', modalKeyHandler);
                return;
            }

            // Tab switching via Tab key
            if (e.key === 'Tab') {
                e.preventDefault();
                this.switchTab(this.activeTab === 'centering' ? 'leveling' : 'centering');
                return;
            }

            if (this.activeTab === 'leveling') {
                if (e.key === '1' || e.code === 'Digit1') window.adjustScrew('A', e.shiftKey ? -1 : 1);
                else if (e.key === '2' || e.code === 'Digit2') window.adjustScrew('B', e.shiftKey ? -1 : 1);
                else if (e.key === '3' || e.code === 'Digit3') window.adjustScrew('C', e.shiftKey ? -1 : 1);
            } else if (this.activeTab === 'centering') {
                if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') window.shiftTribrach(0, -0.06);
                else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') window.shiftTribrach(0, 0.06);
                else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') window.shiftTribrach(-0.06, 0);
                else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') window.shiftTribrach(0.06, 0);
            }

            if (e.key === 'Enter' || e.code === 'Space') {
                window.confirmLeveling();
            }
        };
        window.addEventListener('keydown', modalKeyHandler);

        window.switchTribrachTab = (tabName) => {
            this.switchTab(tabName);
        };

        window.adjustScrew = (screw, delta) => {
            if (screw === 'A') this.screwA += delta;
            if (screw === 'B') this.screwB += delta;
            if (screw === 'C') this.screwC += delta;

            if (window.surveyAudio) window.surveyAudio.playScrewRotate();
            this.recalculateTribrachPhysics();
        };

        window.shiftTribrach = (dx, dy) => {
            this.shiftX += dx;
            this.shiftY += dy;

            if (window.surveyAudio) window.surveyAudio.playClick();
            this.recalculateTribrachPhysics();
        };

        window.confirmLeveling = () => {
            window.removeEventListener('keydown', modalKeyHandler);
            this.finalCenteringErrorMm = parseFloat(this.currentCenterErrorMm || "0.4");
            this.finalLevelingErrorMm = parseFloat(this.currentLevelErrorMm || "0.1");
            this.app.closeModal('leveling-modal');
            this.currentStep = 2;
            if (window.surveyAudio) window.surveyAudio.playSuccessChime();
            this.app.updateMissionPanel(this.title, this.getTasks(), this.currentStep, `基座已鎖定 (對心誤差: ${this.finalCenteringErrorMm}mm, 氣泡殘差: ${this.finalLevelingErrorMm}mm)！按 E 量取儀器斜高。`);
        };
    }

    switchTab(tabName) {
        this.activeTab = tabName;
        const btnCentering = document.getElementById('tab-btn-centering');
        const btnLeveling = document.getElementById('tab-btn-leveling');
        const viewCentering = document.getElementById('tab-content-centering');
        const viewLeveling = document.getElementById('tab-content-leveling');

        if (tabName === 'centering') {
            if (btnCentering) btnCentering.classList.add('active');
            if (btnLeveling) btnLeveling.classList.remove('active');
            if (viewCentering) viewCentering.style.display = 'flex';
            if (viewLeveling) viewLeveling.style.display = 'none';
        } else {
            if (btnCentering) btnCentering.classList.remove('active');
            if (btnLeveling) btnLeveling.classList.add('active');
            if (viewCentering) viewCentering.style.display = 'none';
            if (viewLeveling) viewLeveling.style.display = 'flex';
        }
        this.recalculateTribrachPhysics();
    }

    recalculateTribrachPhysics() {
        const tiltX = (this.screwA * -0.12 + this.screwB * 0.12);
        const tiltY = (this.screwA * 0.08 + this.screwB * 0.08 - this.screwC * 0.16);

        this.bubbleX = 0.50 + tiltX + (this.shiftX * 0.05);
        this.bubbleY = -0.42 + tiltY + (this.shiftY * 0.05);

        this.centerX = 0.55 - this.shiftX + (tiltX * 0.35);
        this.centerY = -0.45 - this.shiftY + (tiltY * 0.35);

        const centerDist = Math.sqrt(this.centerX * this.centerX + this.centerY * this.centerY);
        const centerErrorMm = (centerDist * 4.5).toFixed(1);
        this.currentCenterErrorMm = centerErrorMm;
        this.isCentered = centerDist < 0.10;

        const levelDist = Math.sqrt(this.bubbleX * this.bubbleX + this.bubbleY * this.bubbleY);
        const levelErrorMm = (levelDist * 1.8).toFixed(2);
        this.currentLevelErrorMm = levelErrorMm;
        this.isLeveled = levelDist < 0.10;

        // Update UI
        this.updateBubbleUI();
        this.drawPlummetCanvas();

        const knobA = document.getElementById('knob-a');
        const knobB = document.getElementById('knob-b');
        const knobC = document.getElementById('knob-c');
        if (knobA) knobA.style.transform = `rotate(${this.screwA * 36}deg)`;
        if (knobB) knobB.style.transform = `rotate(${this.screwB * 36}deg)`;
        if (knobC) knobC.style.transform = `rotate(${this.screwC * 36}deg)`;

        const centerPill = document.getElementById('status-center-pill');
        const levelPill = document.getElementById('status-level-pill');
        const centerText = document.getElementById('center-error-text');
        const levelText = document.getElementById('level-error-text');

        if (centerPill && centerText) {
            if (this.isCentered) {
                centerPill.style.color = '#10b981';
                centerText.innerHTML = `<span style="color:#10b981;">✓ 居中 (${centerErrorMm} mm)</span>`;
            } else {
                centerPill.style.color = '#f59e0b';
                centerText.innerHTML = `<span>誤差 (${centerErrorMm} mm)</span>`;
            }
        }

        if (levelPill && levelText) {
            if (this.isLeveled) {
                levelPill.style.color = '#10b981';
                levelText.innerHTML = `<span style="color:#10b981;">✓ 居中 (${levelErrorMm} mm)</span>`;
            } else {
                levelPill.style.color = '#f59e0b';
                levelText.innerHTML = `<span>誤差 (${levelErrorMm} mm)</span>`;
            }
        }
    }

    drawPlummetCanvas() {
        const canvas = document.getElementById('plummet-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.arc(cx, cy, 140, 0, Math.PI * 2);
        ctx.fill();

        const groundPinX = cx + (this.centerX * 180);
        const groundPinY = cy + (this.centerY * 180);

        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.arc(groundPinX, groundPinY, 55, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#64748b';
        ctx.stroke();

        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.arc(groundPinX, groundPinY, 24, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(groundPinX, groundPinY, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        [20, 50, 90, 130].forEach(r => {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
        });

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 120, cy); ctx.lineTo(cx - 12, cy);
        ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 120, cy);
        ctx.moveTo(cx, cy - 120); ctx.lineTo(cx, cy - 12);
        ctx.moveTo(cx, cy + 12); ctx.lineTo(cx, cy + 120);
        ctx.stroke();

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.stroke();
    }

    updateBubbleUI() {
        const drop = document.getElementById('bubble-drop');
        if (!drop) return;
        const maxR = 50;
        const px = Math.max(-maxR, Math.min(maxR, this.bubbleX * 60));
        const py = Math.max(-maxR, Math.min(maxR, this.bubbleY * 60));
        drop.style.transform = `translate(${px}px, ${py}px)`;
    }

    openTapeMeasureModal() {
        this.app.openModal('tape-measure-modal');

        // Generate a realistic true slant height with 0.1mm sub-millimeter precision (e.g. 1.6843m)
        if (!this.trueSlantHeight) {
            this.trueSlantHeight = 1.6843;
        }

        const inputEl = document.getElementById('tape-user-input');
        const feedbackEl = document.getElementById('tape-feedback-text');
        if (inputEl) {
            inputEl.value = '';
            setTimeout(() => inputEl.focus(), 150);
        }
        if (feedbackEl) feedbackEl.innerHTML = '';

        this.drawTapeMeasureCanvas();

        const tapeKeyHandler = (e) => {
            const modal = document.getElementById('tape-measure-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', tapeKeyHandler);
                return;
            }
            if (e.key === 'Enter') {
                window.submitTapeReading();
            }
        };
        window.addEventListener('keydown', tapeKeyHandler);

        window.submitTapeReading = () => {
            const userVal = parseFloat(inputEl.value);
            if (isNaN(userVal) || userVal < 1.0 || userVal > 2.5) {
                if (feedbackEl) {
                    feedbackEl.innerHTML = `<span style="color:#ef4444;">⚠️ 請輸入有效的公尺數值（通常在 1.6000 ~ 1.8000 之間，需估讀至小數點後四位）</span>`;
                }
                return;
            }

            this.playerInputSlantHeight = userVal;
            const diffMm = Math.abs(userVal - this.trueSlantHeight) * 1000;
            this.tapeReadingErrorMm = parseFloat(diffMm.toFixed(2));

            window.removeEventListener('keydown', tapeKeyHandler);

            const hv = Math.sqrt(Math.max(0, userVal * userVal - 0.140 * 0.140)).toFixed(4);

            if (feedbackEl) {
                const diffDesc = this.tapeReadingErrorMm <= 0.1 ? `讀數極其精確 (${this.tapeReadingErrorMm}mm 估讀誤差)！` : `估讀誤差: ${this.tapeReadingErrorMm} mm`;
                feedbackEl.innerHTML = `<span style="color:#10b981;">✓ 已記錄儀器斜高 ${userVal.toFixed(4)} m (換算垂直高 ${hv}m) - ${diffDesc}</span>`;
            }

            // Update GNSS controller modal display text
            const antennaText = document.getElementById('pda-antenna-height-text');
            if (antennaText) {
                antennaText.innerHTML = `天線高: <span style="color:#fff;">${userVal.toFixed(4)} m (Slant) / ${hv} m (Vert)</span>`;
            }

            setTimeout(() => {
                this.app.closeModal('tape-measure-modal');
                this.slantHeightMeasured = true;
                this.currentStep = 3;
                if (window.surveyAudio) window.surveyAudio.playSuccessChime();
                this.app.updateMissionPanel(this.title, this.getTasks(), this.currentStep, `儀器斜高 ${userVal.toFixed(4)}m 已記錄！按 E 操作控制器啟動靜態測量。`);
            }, 900);
        };
    }

    drawTapeMeasureCanvas() {
        const canvas = document.getElementById('tape-measure-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Dark workshop backdrop
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);

        // 1. Draw GNSS Antenna Housing (Bottom curved flange and rubber edge)
        const antennaBaseY = 90;

        // White upper radome
        ctx.fillStyle = '#f1f5f9';
        ctx.beginPath();
        ctx.ellipse(w / 2, antennaBaseY - 60, 240, 90, 0, 0, Math.PI);
        ctx.fill();

        // LED green power ring
        ctx.fillStyle = '#10b981';
        ctx.fillRect(20, antennaBaseY - 14, w - 40, 4);

        // Dark grey bottom bumper plate
        ctx.fillStyle = '#334155';
        ctx.fillRect(40, antennaBaseY - 10, w - 80, 24);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.strokeRect(40, antennaBaseY - 10, w - 80, 24);

        // Label on antenna
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillText("GNSS GEODETIC ANTENNA - R = 0.140 m", 80, antennaBaseY + 6);

        // 2. Yellow Steel Measuring Tape extending up from bottom
        const tapeW = 74;
        const tapeLeft = w / 2 - tapeW / 2;
        const tapeTop = 100;
        const tapeHeight = 220;

        // Tape metallic shadow and body
        ctx.fillStyle = '#eab308'; // Safety survey yellow
        ctx.fillRect(tapeLeft, tapeTop, tapeW, tapeHeight);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ca8a04';
        ctx.strokeRect(tapeLeft, tapeTop, tapeW, tapeHeight);

        // Scale rendering: 1mm = 3.4px scale
        // Real survey rule: Tape extends from bottom (ground 0m) upwards to antenna (~1.68m)
        // Lower values (e.g. 167cm) must be at BOTTOM (+y), Higher values (e.g. 169cm) must be at TOP (-y)
        const pxPerMm = 3.4;
        const targetY = 160; // Alignment reference line Y (where ARP notch touches tape)
        const trueMm = this.trueSlantHeight * 1000; // e.g. 1684 mm

        // Draw scale ticks from trueMm - 35 to trueMm + 35
        for (let mm = Math.floor(trueMm - 35); mm <= Math.ceil(trueMm + 35); mm++) {
            const y = targetY - (mm - trueMm) * pxPerMm;
            if (y < tapeTop || y > tapeTop + tapeHeight) continue;

            const isCm = mm % 10 === 0;
            const is5mm = mm % 5 === 0;

            ctx.strokeStyle = '#000000';
            ctx.fillStyle = '#000000';

            if (isCm) {
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.moveTo(tapeLeft, y);
                ctx.lineTo(tapeLeft + 28, y);
                ctx.stroke();

                // Centimeter number (e.g. 168 cm = 1.68 m), text rendered upright
                ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
                ctx.fillText((mm / 10).toString(), tapeLeft + 32, y + 5);
            } else if (is5mm) {
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(tapeLeft, y);
                ctx.lineTo(tapeLeft + 18, y);
                ctx.stroke();
            } else {
                ctx.lineWidth = 0.9;
                ctx.beginPath();
                ctx.moveTo(tapeLeft, y);
                ctx.lineTo(tapeLeft + 10, y);
                ctx.stroke();
            }
        }

        // 3. ARP Notch Mark (Red Arrow & Alignment Pointer on Antenna Edge)
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(tapeLeft - 30, targetY);
        ctx.lineTo(tapeLeft - 6, targetY - 7);
        ctx.lineTo(tapeLeft - 6, targetY + 7);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(tapeLeft - 6, targetY);
        ctx.lineTo(tapeLeft + tapeW + 12, targetY);
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
        ctx.fillText("▼ ARP 基準緣", tapeLeft - 95, targetY + 4);

        // 4. Optical Magnifying Loupe Window in top-right corner (High Resolution Sub-mm Zoom)
        const loupeX = 345;
        const loupeY = 72;
        const loupeR = 56;

        ctx.save();
        ctx.beginPath();
        ctx.arc(loupeX, loupeY, loupeR, 0, Math.PI * 2);
        ctx.clip();

        // Magnified view inside loupe
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(loupeX - loupeR, loupeY - loupeR, loupeR * 2, loupeR * 2);

        // 16px per 1mm allows easy visual estimation of 0.1mm increments
        const magPxPerMm = 16.0;
        for (let mm = Math.floor(trueMm - 5); mm <= Math.ceil(trueMm + 5); mm++) {
            const my = loupeY - (mm - trueMm) * magPxPerMm;
            const isCm = mm % 10 === 0;
            const is5mm = mm % 5 === 0;

            ctx.strokeStyle = '#000';
            ctx.fillStyle = '#000';
            ctx.lineWidth = isCm ? 3.5 : (is5mm ? 2.2 : 1.4);
            ctx.beginPath();
            ctx.moveTo(loupeX - loupeR, my);
            ctx.lineTo(loupeX - loupeR + (isCm ? 44 : (is5mm ? 28 : 16)), my);
            ctx.stroke();

            if (isCm) {
                ctx.font = 'bold 14px "Segoe UI", sans-serif';
                ctx.fillText((mm / 10).toString(), loupeX - loupeR + 48, my + 5);
            } else if (is5mm) {
                ctx.font = 'bold 11px sans-serif';
                ctx.fillText(`${mm % 10}`, loupeX - loupeR + 32, my + 4);
            }
        }

        // Loupe red hair line
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(loupeX - loupeR, loupeY);
        ctx.lineTo(loupeX + loupeR, loupeY);
        ctx.stroke();

        ctx.restore();

        // Loupe glass border
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(loupeX, loupeY, loupeR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText("🔍 5x 估讀特寫 (0.1mm)", loupeX - 52, loupeY + loupeR + 15);
    }

    openGNSSControllerModal() {
        this.app.openModal('gnss-controller-modal');
        this.epochsRecorded = 0;

        const pBar = document.getElementById('gnss-progress-bar');
        const countElem = document.getElementById('gnss-epoch-count');
        const startBtn = document.getElementById('btn-start-gnss-record');
        const streamLog = document.getElementById('gnss-stream-log');
        const hrmsElem = document.getElementById('gnss-live-hrms');
        const vrmsElem = document.getElementById('gnss-live-vrms');
        const pdopElem = document.getElementById('gnss-live-pdop');

        if (pBar) pBar.style.width = '0%';
        if (countElem) countElem.innerText = `0 / ${this.targetEpochs} 歷元 (0.0%)`;
        if (streamLog) streamLog.innerText = `[IDLE] 點擊下方按鈕開始靜態觀測記錄資料串流...`;
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.innerText = `▶ 開始靜態觀測 (Enter)`;
        }

        let isRecording = false;

        const gnssKeyHandler = (e) => {
            const modal = document.getElementById('gnss-controller-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', gnssKeyHandler);
                return;
            }
            if ((e.key === 'Enter' || e.code === 'Space') && !isRecording) {
                window.startStaticRecording();
            }
        };
        window.addEventListener('keydown', gnssKeyHandler);

        window.startStaticRecording = () => {
            if (isRecording) return;
            isRecording = true;

            if (startBtn) {
                startBtn.disabled = true;
                startBtn.innerText = `⚡ 靜態歷元觀測記錄中 (1 ~ ${this.targetEpochs})...`;
            }

            let soundTick = 0;
            // 5000ms total duration, updating every 35ms -> approx 142 steps
            const interval = setInterval(() => {
                // Add between 9 to 13 epochs per tick
                const delta = Math.floor(Math.random() * 5) + 9;
                this.epochsRecorded = Math.min(this.targetEpochs, this.epochsRecorded + delta);

                const pct = (this.epochsRecorded / this.targetEpochs) * 100;
                if (pBar) pBar.style.width = `${pct}%`;
                if (countElem) countElem.innerText = `${this.epochsRecorded} / ${this.targetEpochs} 歷元 (${pct.toFixed(1)}%)`;

                // Live dynamic jitter for realism
                const hrms = (0.002 + Math.random() * 0.002).toFixed(3);
                const vrms = (0.005 + Math.random() * 0.002).toFixed(3);
                const pdop = (1.23 + Math.random() * 0.07).toFixed(2);

                if (hrmsElem) hrmsElem.innerText = `${hrms}m`;
                if (vrmsElem) vrmsElem.innerText = `${vrms}m`;
                if (pdopElem) pdopElem.innerText = pdop;

                if (streamLog) {
                    streamLog.innerText = `[STREAMING] 歷元 #${this.epochsRecorded} / ${this.targetEpochs} | 19 顆全星座雙頻載波鎖定 | 記錄率 100%`;
                }

                soundTick++;
                if (soundTick % 10 === 0 && window.surveyAudio) {
                    window.surveyAudio.playLaserBeep();
                }

                if (this.epochsRecorded >= this.targetEpochs) {
                    clearInterval(interval);
                    if (startBtn) startBtn.innerText = "✓ 觀測完畢，RINEX 檔案封裝成功！";
                    if (countElem) countElem.innerHTML = `<span style="color:#10b981;">✓ 1440 / 1440 歷元 (100.0% 採集完成)</span>`;
                    if (streamLog) streamLog.innerHTML = `<span style="color:#10b981;">[COMPLETED] 1440 歷元全部固定儲存！RINEX 3.04 外業觀測檔案封裝完畢 (100.0%)</span>`;
                    
                    if (window.surveyAudio) window.surveyAudio.playSuccessChime();

                    setTimeout(() => {
                        window.removeEventListener('keydown', gnssKeyHandler);
                        this.app.closeModal('gnss-controller-modal');
                        this.finishLevel();
                    }, 1200);
                }
            }, 35);
        };

        if (startBtn) {
            startBtn.onclick = () => window.startStaticRecording();
        }
    }

    finishLevel() {
        if (window.surveyAudio) window.surveyAudio.playSuccessChime();

        const cErr = typeof this.finalCenteringErrorMm === 'number' ? this.finalCenteringErrorMm : 0.4;
        const lErr = typeof this.finalLevelingErrorMm === 'number' ? this.finalLevelingErrorMm : 0.1;
        const tErr = typeof this.tapeReadingErrorMm === 'number' ? this.tapeReadingErrorMm : 0.0;
        const playerSlant = this.playerInputSlantHeight || this.trueSlantHeight || 1.684;
        const trueSlant = this.trueSlantHeight || 1.684;

        // Centering score (0 ~ 100)
        let centerScore = Math.max(20, Math.round(100 - cErr * 18));
        let centerDesc = cErr <= 0.5 ? '一等精度 (極佳)' : (cErr <= 1.5 ? '二等精度 (合格)' : '誤差較大 (超限)');

        // Leveling score (0 ~ 100)
        let levelScore = Math.max(20, Math.round(100 - lErr * 45));
        let levelDesc = lErr <= 0.1 ? '氣泡居中 (極佳)' : (lErr <= 0.3 ? '輕微偏移 (合格)' : '明顯傾斜 (超限)');

        // Tape height reading score (0 ~ 100, 0.1mm sub-mm tolerance)
        let tapeScore = Math.max(10, Math.round(100 - tErr * 40));
        let tapeDesc = tErr <= 0.1 ? '0.1mm 精密估讀 (極佳)' : (tErr <= 0.5 ? '毫米級合格' : '目視估讀偏差較大');

        // Overall score (0 ~ 100)
        let totalScore = Math.min(100, Math.max(0, Math.round(centerScore * 0.40 + levelScore * 0.40 + tapeScore * 0.20)));

        let rank = 'S';
        if (totalScore >= 92) rank = 'S';
        else if (totalScore >= 80) rank = 'A';
        else if (totalScore >= 65) rank = 'B';
        else if (totalScore >= 50) rank = 'C';
        else rank = 'F';

        const hv = Math.sqrt(Math.max(0, playerSlant * playerSlant - 0.140 * 0.140)).toFixed(4);

        this.app.completeLevel(this.id, {
            score: totalScore,
            rank: rank,
            details: [
                { label: '測站點號', value: 'CKSV (一等衛星控制點)' },
                { label: '基座光學對心中誤差', value: `${cErr} mm [${centerDesc}, 得分: ${centerScore}]` },
                { label: '圓水準氣泡定平殘差', value: `${lErr} mm [${levelDesc}, 得分: ${levelScore}]` },
                { label: '天線儀器斜高目視估讀 (0.1mm)', value: `真值 ${trueSlant.toFixed(4)}m / 判讀 ${playerSlant.toFixed(4)}m (殘差: ${tErr}mm, 得分: ${tapeScore})` },
                { label: '換算垂直天線高 hv', value: `${hv} m (ARP 半徑 R=0.140m)` },
                { label: '歷元追蹤與解算', value: '1440 歷元 (PDOP 1.28, 19 Sats, 100% 完整率)' },
                { label: '外業成果綜合評分', value: `${totalScore} 分 (評等: ${rank})` }
            ]
        });
    }
}

window.LevelGNSS = LevelGNSS;
