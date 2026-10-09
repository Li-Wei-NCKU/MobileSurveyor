/**
 * Level 3: 畫航測控制標 (GCP Aerial Survey Marking)
 * 
 * 任務流程：
 * 步驟 0：在開闊地形選定地面點位，放置航測標樣板 (GCP-01)
 * 步驟 1：互動塗刷油漆：沾取黑白工程漆在 1.2m 樣板內塗刷，依淺色格位提示完整覆蓋並控制邊緣不溢出
 * 步驟 2：敲入測量鋼釘小遊戲：抓準指針時機連續敲擊 5 下，檢定鋼釘鉛垂垂直度
 * 步驟 3：現場點誌記照片拍攝查核：手持相機拍攝 1 張特寫近照與 2 張包含背景地物特徵(樹木)之廣角遠照
 * 步驟 4：RTK 毫米級三維坐標解算與建檔成果綜合結算！
 */
class LevelGCP {
    constructor(gameApp) {
        this.app = gameApp;
        this.id = 'gcp';
        this.title = '關卡 3: 航測對空標誌 (GCP) 佈設';
        this.currentStep = 0;

        this.gcpTargetPos = new THREE.Vector3(-10, 0, -12);

        // 塗刷與敲釘評分
        this.gcpScore = null;
        this.gcpCoverage = 0;
        this.gcpOverflow = 0;
        this.gcpHammerScore = null;
        this.finalTiltDeg = 0;

        // 塗刷畫布狀態
        this.currentColor = 'black';
        this.brushSize = 28;
        this.isPainting = false;
        this.lastX = null;
        this.lastY = null;
        this.userPaintCanvas = null;
        this.userPaintCtx = null;

        // 敲鋼釘小遊戲狀態
        this.hammerStrikes = 0;
        this.hammerScores = [];
        this.nailTiltDeg = 0;
        this.nailDepth = 0;
        this.hammerAnimId = null;
        this.needlePos = 0;

        // 相機拍照模式狀態 (1張近照 + 2張遠照)
        this.isCameraMode = false;
        this.photoIndex = 0; // 0: 近照, 1: 遠照1, 2: 遠照2
        this.photos = [];
        this.photoScores = [];
    }

    getTasks() {
        return [
            { id: 0, text: "於平坦開闊處選點，鋪設 1.2m 航測對空十字標樣板 (GCP-01)" },
            { id: 1, text: "操作滑鼠塗刷黑白工程標誌漆，依淺色格位填滿四個象限" },
            { id: 2, text: "抓準時機連續敲擊 5 鎚，將測量鋼釘筆直釘入標誌中心" },
            { id: 3, text: "手持相機拍攝點誌記照片 (1 張特寫近照 + 2 張含參考地物之廣角遠照)" },
            { id: 4, text: "使用 GNSS RTK 採集 GCP-01 中心毫米級坐標並完成點誌記建檔" }
        ];
    }

    start() {
        this.app.sceneManager.clearDynamicProps();
        this.app.player.position.set(-8, 1.65, -6);
        this.app.player.euler.set(0, 0, 0);
        this.app.player.camera.position.copy(this.app.player.position);
        this.app.player.camera.quaternion.setFromEuler(this.app.player.euler);

        // Reset all states for clean replay
        this.currentStep = 0;
        this.gcpScore = null;
        this.gcpCoverage = 0;
        this.gcpOverflow = 0;
        this.gcpHammerScore = null;
        this.finalTiltDeg = 0;
        this.isCameraMode = false;
        this.photoIndex = 0;
        this.photos = [];
        this.photoScores = [];

        // Hide camera hud if open
        const camHud = document.getElementById('survey-camera-hud');
        if (camHud) camHud.style.display = 'none';

        // Reset photo thumbnails
        for (let i = 1; i <= 3; i++) {
            const slot = document.getElementById(`cam-slot-${i}`);
            if (slot) {
                slot.innerHTML = i === 1 ? '近照' : `遠照${i-1}`;
                slot.style.border = '2px dashed #475569';
                slot.style.background = '#0b0f19';
            }
        }

        // Single GCP Ground spot for GCP-01
        this.app.sceneManager.createStationSetupZone(-10, -12, "GCP-01 預定點 (開闊無遮蔽)", true);

        // Show ONLY GCP-01 floating marker (Hide CKSV, BM-01, BM-02, etc.)
        this.app.sceneManager.setVisibleFloatingPoints(['GCP-01']);

        this.app.updateMissionPanel(this.title, this.getTasks(), 0, "跟隨 3D 浮空箭頭前往 GCP-01 預定點，按 E 鋪設航測標樣板並開始塗刷。");
    }

    update(dt) {
        if (this.isCameraMode) {
            this.updateCameraTelemetry();
        }
    }

    getInteractionPrompt(obj) {
        if (this.isCameraMode) return null;

        const type = obj.userData ? obj.userData.type : null;
        const label = obj.userData ? (obj.userData.label || '') : '';

        if (this.currentStep === 0 && (type === 'monument' || type === 'gcp') && (!label || label.includes('GCP-01'))) {
            return "鋪設樣板並塗刷黑白工程標誌漆 [GCP-01]";
        }
        if (this.currentStep === 2 && (type === 'gcp' || type === 'monument') && (!label || label.includes('GCP-01'))) {
            return "敲入測量鋼釘 (5 鎚時機檢定) [GCP-01]";
        }
        if (this.currentStep === 4 && (type === 'gcp' || type === 'monument') && (!label || label.includes('GCP-01'))) {
            return "檢視 RTK 成果與點誌記建檔報告 [GCP-01]";
        }

        return null;
    }

    onInteract(obj) {
        if (this.isCameraMode) return;

        if (this.currentStep === 0) {
            this.openPaintModal();
            return;
        }
        if (this.currentStep === 2) {
            this.openHammerModal();
            return;
        }
        if (this.currentStep === 4) {
            this.openRTKSummaryModal();
            return;
        }
    }

    // =========================================================================
    // 步驟 1：互動塗刷黑白航測標油漆小遊戲 (滑鼠拖曳刷漆 + 覆蓋與溢出打分)
    // =========================================================================
    openPaintModal() {
        if (document.exitPointerLock) document.exitPointerLock();
        this.app.openModal('gcp-spray-modal');

        const titleEl = document.getElementById('gcp-active-label');
        if (titleEl) titleEl.innerText = `🎨 正在塗刷：GCP-01 十字黑白航測標 (1.2m × 1.2m)`;

        // Setup user painting canvas (offscreen buffer)
        if (!this.userPaintCanvas) {
            this.userPaintCanvas = document.createElement('canvas');
            this.userPaintCanvas.width = 400;
            this.userPaintCanvas.height = 400;
            this.userPaintCtx = this.userPaintCanvas.getContext('2d', { willReadFrequently: true });
        }
        this.resetUserPaintBuffer();

        this.currentColor = 'black';
        this.brushSize = 28;
        this.updatePaintColorUI();
        this.updateBrushSizeUI();
        this.renderCanvas();

        const canvas = document.getElementById('gcp-stencil-canvas');
        if (!canvas) return;

        // Bind Window Globals for UI buttons
        window.selectGCPPaintColor = (color) => {
            this.currentColor = color;
            this.updatePaintColorUI();
            if (window.surveyAudio) window.surveyAudio.playClick();
        };

        window.setGCPBrushSize = (size) => {
            this.brushSize = size;
            this.updateBrushSizeUI();
            if (window.surveyAudio) window.surveyAudio.playClick();
        };

        window.resetGCPPainting = () => {
            this.resetUserPaintBuffer();
            this.renderCanvas();
            this.evaluatePaintingQuality();
            if (window.surveyAudio) window.surveyAudio.playClick();
        };

        window.confirmSprayDone = () => {
            const stats = this.evaluatePaintingQuality();
            this.app.closeModal('gcp-spray-modal');

            // Generate transparent composite canvas containing ONLY the player's painted strokes
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = 400;
            finalCanvas.height = 400;
            const fCtx = finalCanvas.getContext('2d');
            fCtx.clearRect(0, 0, 400, 400); // 100% transparent background

            // Draw player's painted black and white strokes directly
            if (this.userPaintCanvas) {
                fCtx.drawImage(this.userPaintCanvas, 0, 0);
            }

            // Center red crosshair
            fCtx.strokeStyle = '#ef4444';
            fCtx.lineWidth = 3;
            fCtx.beginPath();
            fCtx.moveTo(200, 10); fCtx.lineTo(200, 390);
            fCtx.moveTo(10, 200); fCtx.lineTo(390, 200);
            fCtx.stroke();

            this.gcpScore = stats.score;
            this.gcpCoverage = stats.coverage;
            this.gcpOverflow = stats.overflow;

            // Save player's custom painted canvas for reuse in Level 4 UAV
            this.app.savedGCPCanvas = finalCanvas;
            window.savedGCPCanvas = finalCanvas;

            // 3D Scene updates with the exact texture painted by the player
            this.app.sceneManager.createGCPTarget(-10, -12, 'GCP-01', finalCanvas);
            this.currentStep = 2;
            if (window.surveyAudio) window.surveyAudio.playSuccessChime();
            this.app.updateMissionPanel(
                this.title, 
                this.getTasks(), 
                this.currentStep, 
                `GCP-01 塗刷完成！(覆蓋率 ${stats.coverage}% | 溢出率 ${stats.overflow}% | 得分: ${stats.score}分)。走近標誌中心按 E 敲入測量鋼釘。`
            );
        };

        // Mouse paint events
        const getCanvasPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };

        const onMouseDown = (e) => {
            this.isPainting = true;
            const pos = getCanvasPos(e);
            this.lastX = pos.x;
            this.lastY = pos.y;
            this.paintStroke(pos.x, pos.y, pos.x, pos.y);
            this.renderCanvas();
            this.evaluatePaintingQuality();
            if (window.surveyAudio) window.surveyAudio.playSprayPaint();
        };

        const onMouseMove = (e) => {
            if (!this.isPainting) return;
            const pos = getCanvasPos(e);
            this.paintStroke(this.lastX, this.lastY, pos.x, pos.y);
            this.lastX = pos.x;
            this.lastY = pos.y;
            this.renderCanvas();
            this.evaluatePaintingQuality();
        };

        const onMouseUp = () => {
            this.isPainting = false;
            this.lastX = null;
            this.lastY = null;
        };

        canvas.onmousedown = onMouseDown;
        window.onmousemove = (e) => {
            if (this.isPainting) onMouseMove(e);
        };
        window.onmouseup = onMouseUp;

        this.evaluatePaintingQuality();
    }

    resetUserPaintBuffer() {
        if (!this.userPaintCtx) return;
        this.userPaintCtx.clearRect(0, 0, 400, 400);
    }

    paintStroke(x1, y1, x2, y2) {
        if (!this.userPaintCtx) return;
        const ctx = this.userPaintCtx;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = this.brushSize;
        ctx.strokeStyle = this.currentColor === 'black' ? '#0f172a' : '#ffffff';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.fillStyle = this.currentColor === 'black' ? '#0f172a' : '#ffffff';
        ctx.beginPath();
        ctx.arc(x2, y2, this.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    updatePaintColorUI() {
        const btnBlack = document.getElementById('paint-btn-black');
        const btnWhite = document.getElementById('paint-btn-white');
        if (btnBlack && btnWhite) {
            if (this.currentColor === 'black') {
                btnBlack.style.borderColor = '#f59e0b';
                btnBlack.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.5)';
                btnWhite.style.borderColor = '#475569';
                btnWhite.style.boxShadow = 'none';
            } else {
                btnWhite.style.borderColor = '#f59e0b';
                btnWhite.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.5)';
                btnBlack.style.borderColor = '#475569';
                btnBlack.style.boxShadow = 'none';
            }
        }
    }

    updateBrushSizeUI() {
        [18, 28, 42].forEach(sz => {
            const btn = document.getElementById(`brush-size-${sz}`);
            if (btn) {
                if (this.brushSize === sz) {
                    btn.className = 'btn-hud btn-primary';
                } else {
                    btn.className = 'btn-hud';
                }
            }
        });
    }

    renderCanvas() {
        const canvas = document.getElementById('gcp-stencil-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = 400;
        const h = canvas.height = 400;

        // 1. Base Soil / Ground Layer (Dark Stone Grey)
        ctx.fillStyle = '#44403c';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        for (let i = 0; i < 200; i++) {
            ctx.fillRect((i * 37) % w, (i * 53) % h, 2, 2);
        }

        // 2. Base Stencil Outer Plate (1.2m Target Plate at x:50..350, y:50..350)
        ctx.fillStyle = '#292524';
        ctx.fillRect(50, 50, 300, 300);

        // 3. Draw User Painted Layer
        if (this.userPaintCanvas) {
            ctx.drawImage(this.userPaintCanvas, 0, 0);
        }

        // 4. Stencil Guide Overlay (Faint 25% Translucency for Target Quadrants)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fillRect(50, 50, 150, 150);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fillRect(200, 50, 150, 150);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fillRect(50, 200, 150, 150);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fillRect(200, 200, 150, 150);

        // Faint Quadrant Label Hints
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillText('⬛ 需刷黑漆', 125, 125);
        ctx.fillText('⬛ 需刷黑漆', 275, 275);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
        ctx.fillText('⬜ 需刷白漆', 275, 125);
        ctx.fillText('⬜ 需刷白漆', 125, 275);

        // 5. Stencil Boundary Wireframe (Yellow Dash)
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(50, 50, 300, 300);

        // Center Axis Crosshairs (Red)
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(200, 40); ctx.lineTo(200, 360);
        ctx.moveTo(40, 200); ctx.lineTo(360, 200);
        ctx.stroke();

        // Center Survey Nail Spot
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(200, 200, 10, 0, Math.PI * 2);
        ctx.stroke();
    }

    evaluatePaintingQuality() {
        if (!this.userPaintCtx) return { coverage: 0, overflow: 0, score: 0 };

        const imgData = this.userPaintCtx.getImageData(0, 0, 400, 400).data;
        const step = 8;
        
        let targetBlackTotal = 0;
        let targetWhiteTotal = 0;
        let correctBlack = 0;
        let correctWhite = 0;
        let wrongColorSpill = 0;
        let outsideBoardSpill = 0;
        let outsideTotal = 0;

        for (let y = 0; y < 400; y += step) {
            for (let x = 0; x < 400; x += step) {
                const idx = (y * 400 + x) * 4;
                const alpha = imgData[idx + 3];
                const r = imgData[idx];
                const g = imgData[idx + 1];
                const b = imgData[idx + 2];

                let painted = null;
                if (alpha > 50) {
                    const brightness = (r + g + b) / 3;
                    painted = brightness > 128 ? 'white' : 'black';
                }

                const isInsideBoard = (x >= 50 && x < 350 && y >= 50 && y < 350);

                if (isInsideBoard) {
                    const isTL = (x < 200 && y < 200);
                    const isBR = (x >= 200 && y >= 200);
                    const isBlackTarget = (isTL || isBR);

                    if (isBlackTarget) {
                        targetBlackTotal++;
                        if (painted === 'black') correctBlack++;
                        else if (painted === 'white') wrongColorSpill++;
                    } else {
                        targetWhiteTotal++;
                        if (painted === 'white') correctWhite++;
                        else if (painted === 'black') wrongColorSpill++;
                    }
                } else {
                    outsideTotal++;
                    if (painted !== null) outsideBoardSpill++;
                }
            }
        }

        const totalTargetPoints = targetBlackTotal + targetWhiteTotal;
        const totalCorrect = correctBlack + correctWhite;
        const coverageRate = totalTargetPoints > 0 ? ((totalCorrect / totalTargetPoints) * 100) : 0;
        const totalSpill = wrongColorSpill + outsideBoardSpill;
        const overflowRate = (totalTargetPoints + outsideTotal) > 0 ? ((totalSpill / totalTargetPoints) * 100) : 0;

        let score = Math.max(0, Math.min(100, Math.round(coverageRate - overflowRate * 1.5)));

        const covEl = document.getElementById('gcp-coverage-rate');
        const ovfEl = document.getElementById('gcp-overflow-rate');
        const cmtEl = document.getElementById('gcp-paint-comment');

        if (covEl) covEl.innerText = `${coverageRate.toFixed(1)}%`;
        if (ovfEl) {
            ovfEl.innerText = `${overflowRate.toFixed(1)}%`;
            ovfEl.style.color = overflowRate > 5 ? '#ef4444' : '#38bdf8';
        }
        if (cmtEl) {
            if (coverageRate < 50) {
                cmtEl.style.color = '#eab308';
                cmtEl.innerText = '⚠️ 覆蓋率偏低！請切換黑/白工程漆將樣板四個象限塗滿。';
            } else if (overflowRate > 8) {
                cmtEl.style.color = '#ef4444';
                cmtEl.innerText = '⚡ 邊緣溢出或錯色偏多！請注意不要塗出黃色邊界或塗錯象限。';
            } else {
                cmtEl.style.color = '#10b981';
                cmtEl.innerText = `★ 噴塗品質極佳！綜合品質預估：${score} 分！可隨時點擊確認。★`;
            }
        }

        return {
            coverage: parseFloat(coverageRate.toFixed(1)),
            overflow: parseFloat(overflowRate.toFixed(1)),
            score: score
        };
    }

    // =========================================================================
    // 步驟 2：敲入測量鋼釘 5 下時機檢定小遊戲
    // =========================================================================
    openHammerModal() {
        if (document.exitPointerLock) document.exitPointerLock();
        this.app.openModal('gcp-hammer-modal');

        this.hammerStrikes = 0;
        this.hammerScores = [];
        this.nailTiltDeg = 0;
        this.nailDepth = 0;
        this.needlePos = 0;

        const countEl = document.getElementById('hammer-strike-count');
        const feedbackEl = document.getElementById('hammer-strike-feedback');
        const statsEl = document.getElementById('hammer-nail-stats');
        const strikeBtn = document.getElementById('btn-hammer-strike');

        if (countEl) countEl.innerText = "第 1 / 5 下";
        if (feedbackEl) {
            feedbackEl.style.color = '#38bdf8';
            feedbackEl.innerText = '★ 抓準指針抵達中央綠色區域時按下敲擊 ★';
        }
        if (statsEl) statsEl.innerText = "釘入深度: 0% | 傾斜度: 0.0°";
        if (strikeBtn) {
            strikeBtn.disabled = false;
            strikeBtn.focus();
        }

        this.renderHammerNailCanvas();

        let startTime = performance.now();
        if (this.hammerAnimId) cancelAnimationFrame(this.hammerAnimId);

        const updateNeedle = (now) => {
            const modal = document.getElementById('gcp-hammer-modal');
            if (!modal || !modal.classList.contains('show')) return;

            const t = (now - startTime) / 1000;
            this.needlePos = Math.sin(t * 3.8);

            const needleEl = document.getElementById('hammer-timing-needle');
            if (needleEl) {
                needleEl.style.left = `calc(50% + ${this.needlePos * 44}%)`;
            }

            this.hammerAnimId = requestAnimationFrame(updateNeedle);
        };
        this.hammerAnimId = requestAnimationFrame(updateNeedle);

        const hammerKeyHandler = (e) => {
            const modal = document.getElementById('gcp-hammer-modal');
            if (!modal || !modal.classList.contains('show')) {
                window.removeEventListener('keydown', hammerKeyHandler);
                return;
            }
            if (e.key === 'Enter' || e.code === 'Space') {
                e.preventDefault();
                window.triggerHammerStrike();
            }
        };
        window.addEventListener('keydown', hammerKeyHandler);

        window.triggerHammerStrike = () => {
            if (this.hammerStrikes >= 5) return;
            this.hammerStrikes++;

            const offset = Math.abs(this.needlePos);
            let strikeScore = 0;
            let strikeComment = '';
            let strikeColor = '#10b981';

            if (offset <= 0.16) {
                strikeScore = 100;
                strikeComment = '🎯 完美垂直重擊！(100分)';
                strikeColor = '#10b981';
            } else if (offset <= 0.38) {
                strikeScore = 85;
                strikeComment = '⚡ 良好！輕微微偏 (85分)';
                strikeColor = '#eab308';
            } else if (offset <= 0.68) {
                strikeScore = 60;
                strikeComment = '⚠️ 偏斜失準 (60分)';
                strikeColor = '#f97316';
            } else {
                strikeScore = 30;
                strikeComment = '❌ 嚴重偏心敲歪！(30分)';
                strikeColor = '#ef4444';
            }

            this.hammerScores.push(strikeScore);
            this.nailTiltDeg += this.needlePos * 1.5;
            this.nailDepth = this.hammerStrikes * 20;

            if (window.surveyAudio) window.surveyAudio.playHammer();

            if (countEl) countEl.innerText = `第 ${Math.min(5, this.hammerStrikes + 1)} / 5 下`;
            if (feedbackEl) {
                feedbackEl.style.color = strikeColor;
                feedbackEl.innerText = `第 ${this.hammerStrikes} 擊：${strikeComment}`;
            }
            if (statsEl) {
                statsEl.innerText = `釘入深度: ${this.nailDepth}% | 累積傾斜: ${Math.abs(this.nailTiltDeg).toFixed(1)}°`;
                statsEl.style.color = Math.abs(this.nailTiltDeg) <= 1.5 ? '#10b981' : '#ef4444';
            }

            this.renderHammerNailCanvas();

            if (this.hammerStrikes >= 5) {
                if (this.hammerAnimId) cancelAnimationFrame(this.hammerAnimId);
                if (strikeBtn) strikeBtn.disabled = true;
                window.removeEventListener('keydown', hammerKeyHandler);

                this.gcpHammerScore = Math.round(this.hammerScores.reduce((a, b) => a + b, 0) / this.hammerScores.length);
                this.finalTiltDeg = Math.abs(this.nailTiltDeg).toFixed(1);

                if (feedbackEl) {
                    feedbackEl.style.color = '#10b981';
                    feedbackEl.innerText = `✓ 測釘已完全釘入地面！最終垂直偏差: ${this.finalTiltDeg}° (敲擊評分: ${this.gcpHammerScore}分)`;
                }

                setTimeout(() => {
                    this.app.closeModal('gcp-hammer-modal');
                    if (window.surveyAudio) window.surveyAudio.playSuccessChime();
                    this.startCameraMode();
                }, 1200);
            }
        };
    }

    renderHammerNailCanvas() {
        const canvas = document.getElementById('hammer-nail-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = 250;
        const h = canvas.height = 250;

        ctx.fillStyle = '#1c1917';
        ctx.fillRect(0, 0, w, h);

        const groundY = 140;

        ctx.fillStyle = '#44403c';
        ctx.fillRect(0, groundY, w, h - groundY);

        ctx.fillStyle = '#292524';
        for (let i = 0; i < 60; i++) {
            ctx.fillRect((i * 29) % w, groundY + ((i * 17) % (h - groundY)), 3, 3);
        }

        ctx.fillStyle = '#0c0a09';
        ctx.fillRect(0, 0, w, groundY);

        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(20, groundY);
        ctx.lineTo(w - 20, groundY);
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('1.2m 航測標板面', 30, groundY - 6);

        const maxPenetration = 70;
        const currentPenetration = (this.nailDepth / 100) * maxPenetration;
        const nailBaseY = groundY - 80 + currentPenetration;

        ctx.save();
        ctx.translate(w / 2, nailBaseY + 80);
        ctx.rotate((this.nailTiltDeg * Math.PI) / 180);

        const shankGrad = ctx.createLinearGradient(-5, 0, 5, 0);
        shankGrad.addColorStop(0, '#94a3b8');
        shankGrad.addColorStop(0.5, '#f8fafc');
        shankGrad.addColorStop(1, '#64748b');
        ctx.fillStyle = shankGrad;
        ctx.fillRect(-4, -80, 8, 75);

        ctx.beginPath();
        ctx.moveTo(-4, -5);
        ctx.lineTo(4, -5);
        ctx.lineTo(0, 10);
        ctx.closePath();
        ctx.fill();

        const headGrad = ctx.createLinearGradient(-14, 0, 14, 0);
        headGrad.addColorStop(0, '#d97706');
        headGrad.addColorStop(0.5, '#fde047');
        headGrad.addColorStop(1, '#b45309');
        ctx.fillStyle = headGrad;
        ctx.fillRect(-14, -86, 28, 7);

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-6, -82.5); ctx.lineTo(6, -82.5);
        ctx.stroke();

        ctx.restore();

        if (this.hammerStrikes > 0) {
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(w / 2, nailBaseY, 6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // =========================================================================
    // 步驟 3：現場點誌記照片拍攝查核 (1張特寫近照 + 2張背景地物遠景照)
    // =========================================================================
    startCameraMode() {
        this.currentStep = 3;
        this.isCameraMode = true;
        this.photoIndex = 0;
        this.photos = [];
        this.photoScores = [];

        const camHud = document.getElementById('survey-camera-hud');
        if (camHud) camHud.style.display = 'flex';

        this.updateCameraStageUI();
        this.app.updateMissionPanel(
            this.title, 
            this.getTasks(), 
            this.currentStep, 
            "測釘固定完成！開啟相機模式：請依序拍攝 1 張特寫近照與 2 張背景地物遠景照片 (按空白鍵拍照)。"
        );

        // Global Shutter Handler
        window.triggerSurveyPhoto = () => {
            if (!this.isCameraMode) return;
            this.captureCurrentPhoto();
        };

        const camKeyHandler = (e) => {
            if (!this.isCameraMode) {
                window.removeEventListener('keydown', camKeyHandler);
                return;
            }
            if (e.code === 'Space' || e.key === 'Enter') {
                e.preventDefault();
                this.captureCurrentPhoto();
            }
        };
        window.addEventListener('keydown', camKeyHandler);
    }

    updateCameraStageUI() {
        const badge = document.getElementById('cam-photo-badge');
        const instruction = document.getElementById('cam-stage-instruction');
        const featBox = document.getElementById('cam-feature-box');

        if (this.photoIndex === 0) {
            if (badge) badge.innerText = "第 1 / 3 張：特寫近照";
            if (instruction) instruction.innerHTML = "【近照】：請靠近標誌 (<strong style='color:#facc15;'>1.5m ~ 3.5m</strong>)，俯視鏡頭完整涵蓋 1.2m 航測標且不要切邊。";
            if (featBox) featBox.style.display = 'none';
        } else if (this.photoIndex === 1) {
            if (badge) badge.innerText = "第 2 / 3 張：廣角遠照 1";
            if (instruction) instruction.innerHTML = "【遠照 1】：請退後 (<strong style='color:#facc15;'>8m ~ 20m</strong>)，將航測標與後方樹木/地貌特徵一同拍攝入鏡。";
            if (featBox) featBox.style.display = 'block';
        } else {
            if (badge) badge.innerText = "第 3 / 3 張：廣角遠照 2";
            if (instruction) instruction.innerHTML = "【遠照 2】：請移至另一個視角方位 (<strong style='color:#facc15;'>8m ~ 20m</strong>)，拍攝第二張包含背景地物的遠照。";
            if (featBox) featBox.style.display = 'block';
        }
    }

    updateCameraTelemetry() {
        const playerPos = this.app.player.position;
        const cam = this.app.player.camera;
        const dist = playerPos.distanceTo(this.gcpTargetPos);

        const distEl = document.getElementById('cam-dist-val');
        const targetEl = document.getElementById('cam-target-status');
        const featEl = document.getElementById('cam-feature-status');

        if (distEl) distEl.innerText = `${dist.toFixed(1)} m`;

        // Check if camera forward vector is pointing toward GCP-01
        const toTarget = new THREE.Vector3().subVectors(this.gcpTargetPos, cam.position).normalize();
        const camDir = new THREE.Vector3();
        cam.getWorldDirection(camDir);
        const dot = camDir.dot(toTarget);
        const isFacingTarget = dot > 0.70; // within ~45 deg cone

        if (targetEl) {
            if (isFacingTarget) {
                targetEl.innerHTML = "<span style='color:#10b981;'>✓ 標誌於鏡頭內</span>";
            } else {
                targetEl.innerHTML = "<span style='color:#ef4444;'>✕ 請對準航測標</span>";
            }
        }

        // Check for reference trees behind/around target in distant photos
        if (this.photoIndex >= 1 && featEl) {
            let treesInView = 0;
            if (this.app.sceneManager.trees) {
                this.app.sceneManager.trees.forEach(tree => {
                    const toTree = new THREE.Vector3().subVectors(tree.position, cam.position).normalize();
                    if (camDir.dot(toTree) > 0.65) treesInView++;
                });
            }
            if (treesInView > 0) {
                featEl.innerHTML = `<span style='color:#10b981;'>✓ 包含參考樹木 (${treesInView} 棵)</span>`;
            } else {
                featEl.innerHTML = "<span style='color:#f97316;'>⚠️ 鏡頭未包含背景樹木</span>";
            }
        }
    }

    captureCurrentPhoto() {
        const playerPos = this.app.player.position;
        const cam = this.app.player.camera;
        const dist = playerPos.distanceTo(this.gcpTargetPos);

        const toTarget = new THREE.Vector3().subVectors(this.gcpTargetPos, cam.position).normalize();
        const camDir = new THREE.Vector3();
        cam.getWorldDirection(camDir);
        const dot = camDir.dot(toTarget);
        const isFacing = dot > 0.65;

        // Flash animation & audio
        const flash = document.getElementById('camera-flash-overlay');
        if (flash) {
            flash.style.opacity = '0.9';
            setTimeout(() => { flash.style.opacity = '0'; }, 180);
        }
        if (window.surveyAudio) window.surveyAudio.playCameraShutter();

        let score = 0;
        let report = '';

        if (this.photoIndex === 0) {
            // 近照 (Close-up) evaluation
            const inDistRange = (dist >= 1.2 && dist <= 3.8);
            if (inDistRange && isFacing) {
                score = Math.round(90 + Math.max(0, 10 - Math.abs(dist - 2.2) * 6));
                report = `特寫完整覆蓋 1.2m 標誌 (距離: ${dist.toFixed(1)}m)`;
            } else if (!isFacing) {
                score = 35;
                report = `未對準航測標中心`;
            } else {
                score = Math.max(40, Math.round(80 - Math.abs(dist - 2.5) * 15));
                report = dist < 1.2 ? `距離過近切邊 (${dist.toFixed(1)}m)` : `距離偏遠特寫不足 (${dist.toFixed(1)}m)`;
            }
        } else {
            // 遠照 (Distant) evaluation: check distance + target + background tree features
            let treesInView = 0;
            if (this.app.sceneManager.trees) {
                this.app.sceneManager.trees.forEach(tree => {
                    const toTree = new THREE.Vector3().subVectors(tree.position, cam.position).normalize();
                    if (camDir.dot(toTree) > 0.65) treesInView++;
                });
            }

            const inDistRange = (dist >= 6.0 && dist <= 26.0);
            let baseScore = inDistRange ? 50 : Math.max(15, 50 - Math.abs(dist - 12) * 3);
            let targetScore = isFacing ? 25 : 0;
            let treeScore = Math.min(25, treesInView * 12.5);

            score = Math.round(baseScore + targetScore + treeScore);
            report = `遠景距離: ${dist.toFixed(1)}m | 標誌入鏡: ${isFacing ? '✓' : '✕'} | 背景參考樹木: ${treesInView} 棵`;
        }

        this.photoScores.push(score);

        // Update photo filmstrip slot in HUD
        const currentSlotNum = this.photoIndex + 1;
        const slotEl = document.getElementById(`cam-slot-${currentSlotNum}`);
        if (slotEl) {
            slotEl.innerHTML = `<span style='color:#10b981; font-weight:700;'>✓ ${score}分</span>`;
            slotEl.style.border = '2px solid #10b981';
            slotEl.style.background = '#064e3b';
        }

        this.photos.push({
            type: this.photoIndex === 0 ? '特寫近照' : `廣角遠照 ${this.photoIndex}`,
            score: score,
            dist: dist.toFixed(1),
            report: report
        });

        this.photoIndex++;

        if (this.photoIndex < 3) {
            this.updateCameraStageUI();
            this.app.updateMissionPanel(
                this.title, 
                this.getTasks(), 
                this.currentStep, 
                `照片 ${this.photoIndex}/3 拍攝成功 (${score}分)！請繼續拍攝下一張照片。`
            );
        } else {
            // All 3 photos completed!
            this.isCameraMode = false;
            const camHud = document.getElementById('survey-camera-hud');
            if (camHud) camHud.style.display = 'none';

            this.currentStep = 4;
            if (window.surveyAudio) window.surveyAudio.playSuccessChime();
            this.openRTKSummaryModal();
        }
    }

    // =========================================================================
    // 步驟 4：RTK 坐標採集與點位成果建檔總覽
    // =========================================================================
    openRTKSummaryModal() {
        if (document.exitPointerLock) document.exitPointerLock();
        this.app.openModal('gcp-rtk-modal');

        const grid = document.getElementById('rtk-photo-review-grid');
        const summary = document.getElementById('rtk-photo-score-summary');

        if (grid) {
            grid.innerHTML = '';
            this.photos.forEach((p, idx) => {
                const card = document.createElement('div');
                card.style.cssText = 'flex:1; background:#1e293b; border-radius:6px; padding:8px 6px; text-align:center; font-size:11px;';
                card.innerHTML = `
                    <div style="font-weight:700; color:#facc15; margin-bottom:2px;">${p.type}</div>
                    <div style="color:#10b981; font-weight:700; font-size:13px;">${p.score} 分</div>
                    <div style="color:#94a3b8; font-size:10px; margin-top:2px;">${p.dist}m</div>
                `;
                grid.appendChild(card);
            });
        }

        const avgPhotoScore = this.photoScores.length > 0 ? Math.round(this.photoScores.reduce((a, b) => a + b, 0) / this.photoScores.length) : 95;

        if (summary) {
            summary.innerHTML = `<span style='color:#10b981;'>✓ 3 張照片查核完成！照片平均品質: ${avgPhotoScore} 分 (近照完整涵蓋、遠照均包含背景樹木特徵)</span>`;
        }

        window.confirmGCPCompletion = () => {
            this.app.closeModal('gcp-rtk-modal');
            this.finishLevel();
        };
    }

    finishLevel() {
        if (window.surveyAudio) window.surveyAudio.playSuccessChime();

        const pScore = typeof this.gcpScore === 'number' ? this.gcpScore : 95;
        const hScore = typeof this.gcpHammerScore === 'number' ? this.gcpHammerScore : 90;
        const avgPhoto = this.photoScores.length > 0 ? Math.round(this.photoScores.reduce((a, b) => a + b, 0) / this.photoScores.length) : 95;

        const totalScore = Math.round(pScore * 0.35 + hScore * 0.35 + avgPhoto * 0.30);

        let rank = 'S';
        if (totalScore >= 92) rank = 'S';
        else if (totalScore >= 80) rank = 'A';
        else if (totalScore >= 65) rank = 'B';
        else if (totalScore >= 50) rank = 'C';
        else rank = 'F';

        this.app.completeLevel(this.id, {
            score: totalScore,
            rank: rank,
            details: [
                { label: '航測標誌尺寸規範', value: '1.2m × 1.2m (符合 GSD 2.5cm 航測標準)' },
                { label: 'GCP-01 樣板塗刷品質', value: `覆蓋率: ${this.gcpCoverage}% / 溢出率: ${this.gcpOverflow}% [得分: ${pScore}分]` },
                { label: '測釘 5 下時機敲擊檢定', value: `垂直偏差: ${this.finalTiltDeg}° [得分: ${hScore}分]` },
                { label: '點誌記照片查核 (1近2遠)', value: `特寫近照: ${this.photoScores[0] || 95}分 / 遠照1: ${this.photoScores[1] || 90}分 / 遠照2: ${this.photoScores[2] || 90}分 [平均: ${avgPhoto}分]` },
                { label: 'RTK 三維坐標解算品質', value: 'Fixed 3D (24 Sats | Hz: 0.007m, Vt: 0.011m)' },
                { label: '航測標佈設外業綜合評分', value: `${totalScore} 分 (評等: ${rank})` }
            ]
        });
    }
}

window.LevelGCP = LevelGCP;
