/**
 * Level 3: 全站儀測量 (Total Station Survey)
 * Mechanics: Laser centering & dual-axis digital bubble compensation, prism aiming with fine tangent screws,
 * EDM laser ranging measurement, angle/distance calculation.
 */
class LevelTotalStation {
    constructor(gameApp) {
        this.app = gameApp;
        this.id = 'totalstation';
        this.title = '關卡 3: 全站儀測量';
        this.currentStep = 0;

        this.tsMesh = null;
        this.prismMesh = null;

        // Dual axis electronic level (arcseconds tilt)
        this.tiltX = 42; // arcsec
        this.tiltY = -35;
        this.isLeveled = false;

        // Aiming offset
        this.aimX = 120; // px offset from prism center
        this.aimY = -80;
        this.isAimed = false;
        this.isEDMMeasured = false;

        // Survey data
        this.ha = "128° 42' 16\"";
        this.va = "88° 15' 02\"";
        this.sd = 32.482;
        this.hd = 32.466;
        this.vd = 0.991;
    }

    getTasks() {
        return [
            { id: 0, text: "前往導線控制點 CP-03 並架設全站儀" },
            { id: 1, text: "啟動雷射對心與雙軸電子水準補償器，調整腳螺旋使 X/Y 軸傾角 < 5\"" },
            { id: 2, text: "轉動望遠鏡與水平/垂直微動螺旋，十字絲精確瞄準遠方稜鏡中心" },
            { id: 3, text: "觸發 EDM 紅外測距儀進行斜距、平距與高差量測" },
            { id: 4, text: "記錄測點三維坐標 (N, E, Z) 並完成導線點採集" }
        ];
    }

    getInteractionPrompt(obj) {
        const type = obj.userData ? obj.userData.type : null;
        if (type === 'monument' && obj.userData.label && obj.userData.label.includes('CP-03')) {
            if (this.currentStep === 0) return "架設電子全站儀 [CP-03 導線點]";
        }
        if (type === 'instrument' && obj.userData.instrumentType === 'totalstation') {
            if (this.currentStep === 1) return "啟動雙軸電子水準傾斜補償 [Total Station]";
            if (this.currentStep === 2 || this.currentStep === 3) return "望遠鏡微動照準稜鏡並觸發 EDM 測距";
            if (this.currentStep === 4) return "結算並記錄導線點三維坐標 (N, E, Z)";
        }
        if (type === 'prism') {
            return "照準遠方反射稜鏡目標";
        }
        return null;
    }

    start() {
        this.app.sceneManager.clearDynamicProps();
        this.app.player.position.set(-15, 1.65, 18);
        this.app.player.euler.set(0, 0, 0);
        this.app.player.camera.position.copy(this.app.player.position);
        this.app.player.camera.quaternion.setFromEuler(this.app.player.euler);

        // Reset all states for clean replay
        this.currentStep = 0;
        this.tsMesh = null;
        this.isLeveled = false;
        this.tiltX = 42;
        this.tiltY = -35;
        this.aimOffsetX = 45;
        this.aimOffsetY = -38;
        this.isAimed = false;
        this.edmTriggered = false;

        // Place Prism Target 32m away
        this.prismMesh = this.app.sceneManager.createPrismTarget(10, 0);

        // Spawn dynamic 2.4m setup pad under target active monument CP-03
        this.app.sceneManager.createStationSetupZone(-15, 15, "CP-03 (導線控制點)", false);

        this.app.updateMissionPanel(this.title, this.getTasks(), this.currentStep, "前往 CP-03 控制點標誌，按 E 架設全站儀。");
    }

    onInteract(obj) {
        const type = obj.userData.type;

        if (this.currentStep === 0 && type === 'monument' && obj.userData.label.includes('CP-03')) {
            this.tsMesh = this.app.sceneManager.createTripodWithInstrument(obj.position.x, obj.position.z, 'totalstation');
            if (window.surveyAudio) window.surveyAudio.playClick();
            this.currentStep = 1;
            this.app.updateMissionPanel(this.title, this.getTasks(), this.currentStep, "全站儀已架設。靠近全站儀按 E 啟動雷射對心與雙軸電子定平。");
            return;
        }

        if (type === 'instrument' && obj.userData.instrumentType === 'totalstation') {
            if (this.currentStep === 1) {
                this.openDualAxisModal();
            } else if (this.currentStep === 2 || this.currentStep === 3) {
                this.openTotalStationScope();
            } else if (this.currentStep === 4) {
                this.openTSCoordinateModal();
            }
        }
    }

    openDualAxisModal() {
        this.app.openModal('ts-dualaxis-modal');
        this.updateDualAxisUI();

        const tsLevelKeyHandler = (e) => {
            const modal = document.getElementById('ts-dualaxis-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', tsLevelKeyHandler);
                return;
            }
            if (e.key === 'ArrowLeft' || e.code === 'KeyA') window.adjustDualAxisScrew('X', -1);
            else if (e.key === 'ArrowRight' || e.code === 'KeyD') window.adjustDualAxisScrew('X', 1);
            else if (e.key === 'ArrowUp' || e.code === 'KeyW') window.adjustDualAxisScrew('Y', -1);
            else if (e.key === 'ArrowDown' || e.code === 'KeyS') window.adjustDualAxisScrew('Y', 1);
            else if ((e.key === 'Enter' || e.code === 'Space') && this.isLeveled) {
                window.confirmTSLeveling();
            }
        };
        window.addEventListener('keydown', tsLevelKeyHandler);

        window.adjustDualAxisScrew = (axis, dir) => {
            if (axis === 'X') this.tiltX -= dir * 8;
            if (axis === 'Y') this.tiltY -= dir * 8;
            if (window.surveyAudio) window.surveyAudio.playScrewRotate();
            this.updateDualAxisUI();

            if (Math.abs(this.tiltX) <= 4 && Math.abs(this.tiltY) <= 4) {
                this.isLeveled = true;
                document.getElementById('ts-tilt-status').innerHTML = "<span style='color:#10b981'>✓ 雙軸補償水準合格 (X, Y 均 < 5\")！(按 Enter 確認)</span>";
                document.getElementById('btn-confirm-ts-level').disabled = false;
            } else {
                this.isLeveled = false;
                document.getElementById('btn-confirm-ts-level').disabled = true;
            }
        };

        window.confirmTSLeveling = () => {
            window.removeEventListener('keydown', tsLevelKeyHandler);
            this.app.closeModal('ts-dualaxis-modal');
            this.currentStep = 2;
            if (window.surveyAudio) window.surveyAudio.playSuccessChime();
            this.app.updateMissionPanel(this.title, this.getTasks(), this.currentStep, "定心定平完成！靠近全站儀按 E 進入望遠鏡照準稜鏡。");
        };
    }

    updateDualAxisUI() {
        document.getElementById('tilt-x-val').innerText = `${this.tiltX >= 0 ? '+' : ''}${this.tiltX}"`;
        document.getElementById('tilt-y-val').innerText = `${this.tiltY >= 0 ? '+' : ''}${this.tiltY}"`;

        const dot = document.getElementById('ts-electronic-dot');
        if (dot) {
            const px = Math.max(-50, Math.min(50, this.tiltX * 1.2));
            const py = Math.max(-50, Math.min(50, this.tiltY * 1.2));
            dot.style.transform = `translate(${px}px, ${py}px)`;
            dot.style.background = (Math.abs(this.tiltX) <= 4 && Math.abs(this.tiltY) <= 4) ? '#10b981' : '#f59e0b';
        }
    }

    openTotalStationScope() {
        this.app.openModal('ts-scope-modal');
        this.renderPrismScope();

        const tsScopeKeyHandler = (e) => {
            const modal = document.getElementById('ts-scope-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', tsScopeKeyHandler);
                return;
            }
            if (e.key === 'ArrowUp' || e.code === 'KeyW') window.nudgeTangentScrew(0, 20);
            else if (e.key === 'ArrowDown' || e.code === 'KeyS') window.nudgeTangentScrew(0, -20);
            else if (e.key === 'ArrowLeft' || e.code === 'KeyA') window.nudgeTangentScrew(20, 0);
            else if (e.key === 'ArrowRight' || e.code === 'KeyD') window.nudgeTangentScrew(-20, 0);
            else if (e.code === 'Space' && this.isAimed && !this.isEDMMeasured) {
                window.triggerEDM();
            } else if ((e.key === 'Enter' || e.code === 'Space') && this.isEDMMeasured) {
                window.confirmTSScope();
            }
        };
        window.addEventListener('keydown', tsScopeKeyHandler);

        window.nudgeTangentScrew = (dx, dy) => {
            this.aimX += dx;
            this.aimY += dy;
            if (window.surveyAudio) window.surveyAudio.playClick();
            this.renderPrismScope();

            const dist = Math.sqrt(this.aimX * this.aimX + this.aimY * this.aimY);
            if (dist < 12) {
                this.isAimed = true;
                document.getElementById('ts-aim-status').innerHTML = "<span style='color:#10b981'>◎ 十字絲已精確鎖定稜鏡中心！可按空白鍵發射 EDM 測距</span>";
                document.getElementById('btn-ts-edm-measure').disabled = false;
            } else {
                this.isAimed = false;
                document.getElementById('ts-aim-status').innerText = `照準偏移中 (殘差 ${dist.toFixed(0)}px)，請旋轉微動螺旋 (方向鍵或 W/A/S/D)`;
                document.getElementById('btn-ts-edm-measure').disabled = true;
            }
        };

        window.triggerEDM = () => {
            if (!this.isAimed) return;
            const btn = document.getElementById('btn-ts-edm-measure');
            btn.disabled = true;
            btn.innerText = "EDM 雷射發射中...";
            if (window.surveyAudio) window.surveyAudio.playLaserBeep();

            setTimeout(() => {
                if (window.surveyAudio) window.surveyAudio.playEDMLock();
                btn.innerText = "✓ 測距成功";
                this.isEDMMeasured = true;
                document.getElementById('ts-lcd-screen').style.display = 'block';
                document.getElementById('ts-ha-val').innerText = this.ha;
                document.getElementById('ts-va-val').innerText = this.va;
                document.getElementById('ts-sd-val').innerText = `${this.sd.toFixed(3)} m`;
                document.getElementById('ts-hd-val').innerText = `${this.hd.toFixed(3)} m`;
                document.getElementById('ts-vd-val').innerText = `+${this.vd.toFixed(3)} m`;
                document.getElementById('btn-confirm-ts-scope').disabled = false;
            }, 900);
        };

        window.confirmTSScope = () => {
            window.removeEventListener('keydown', tsScopeKeyHandler);
            this.app.closeModal('ts-scope-modal');
            this.currentStep = 4;
            if (window.surveyAudio) window.surveyAudio.playSuccessChime();
            this.app.updateMissionPanel(this.title, this.getTasks(), this.currentStep, "EDM 測量數據已獲取！按 E 檢視導線點三維坐標結算。");
        };
    }

    renderPrismScope() {
        const canvas = document.getElementById('ts-scope-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = 500;
        const h = canvas.height = 500;

        ctx.fillStyle = '#64748b';
        ctx.fillRect(0, 0, w, h);

        // Outdoor landscape
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(0.55, '#86efac');
        grad.addColorStop(1, '#15803d');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Draw Prism Target
        ctx.save();
        ctx.translate(w / 2 - this.aimX, h / 2 - this.aimY);

        // Orange Target Plate
        ctx.fillStyle = '#ea580c';
        ctx.fillRect(-70, -70, 140, 140);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.strokeRect(-70, -70, 140, 140);

        // Yellow chevron triangles
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.moveTo(0, -70); ctx.lineTo(-30, -35); ctx.lineTo(30, -35); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 70); ctx.lineTo(-30, 35); ctx.lineTo(30, 35); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-70, 0); ctx.lineTo(-35, -30); ctx.lineTo(-35, 30); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(70, 0); ctx.lineTo(35, -30); ctx.lineTo(35, 30); ctx.fill();

        // Circular Glass Prism Center
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.arc(0, 0, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Prism internal corner reflection
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, -35);
        ctx.moveTo(0, 0); ctx.lineTo(-30, 18);
        ctx.moveTo(0, 0); ctx.lineTo(30, 18);
        ctx.stroke();

        ctx.restore();

        // Overlay Crosshair
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
        ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
        ctx.stroke();

        // Center reticle ring
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 16, 0, Math.PI * 2);
        ctx.stroke();
    }

    openTSCoordinateModal() {
        this.app.openModal('ts-coord-modal');

        const coordKeyHandler = (e) => {
            const modal = document.getElementById('ts-coord-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', coordKeyHandler);
                return;
            }
            if (e.key === 'Enter' || e.code === 'Space') {
                window.confirmTSComplete();
            }
        };
        window.addEventListener('keydown', coordKeyHandler);

        window.confirmTSComplete = () => {
            window.removeEventListener('keydown', coordKeyHandler);
            this.app.closeModal('ts-coord-modal');
            this.finishLevel();
        };
    }

    finishLevel() {
        if (window.surveyAudio) window.surveyAudio.playSuccessChime();
        this.app.completeLevel(this.id, {
            score: 100,
            rank: 'S',
            details: [
                { label: '雙軸電子水準傾斜補償', value: 'X: +2", Y: -1" (符合三級導線)' },
                { label: '雷射對心中誤差', value: '0.1 mm' },
                { label: '十字絲稜鏡照準殘差', value: '< 2 px' },
                { label: '水平角 HA / 垂直角 VA', value: `${this.ha} / ${this.va}` },
                { label: '斜距 SD / 平距 HD', value: `${this.sd.toFixed(3)}m / ${this.hd.toFixed(3)}m` },
                { label: '測點三維坐標採集', value: 'N: 2765432.105, E: 301248.552, Z: 48.991' }
            ]
        });
    }
}

window.LevelTotalStation = LevelTotalStation;
