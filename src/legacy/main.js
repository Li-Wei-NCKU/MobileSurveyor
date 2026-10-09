/**
 * Surveyor Game - Main Controller & Application Core
 * Coordinates 3D Scene, Player, Sound, Level State, and UI Modals.
 */
class SurveyorGameApp {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.sceneManager = new SurveyScene(this.container);
        this.player = new SurveyPlayer(this.sceneManager, (obj) => this.handleInteraction(obj));
        this.levelManager = new LevelSelectManager(this);

        this.levelSequence = ['gnss', 'leveling', 'gcp', 'uav'];
        this.currentLevelId = 'gnss';
        this.currentLevelObj = null;
        this.campaignResults = {};

        this.clock = { _t: performance.now(), getDelta() { const n = performance.now(); const d = (n - this._t) / 1000; this._t = n; return Math.min(d, 0.1); } };
        this.isAudioMuted = false;

        this.initLevels();
        this.initUIEvents();
        this.animate();

        // 交給新系統 (主選單 / 外業一日)；若未載入則直接進入練習關卡
        if (window.onGameAppReady) window.onGameAppReady(this);
        else this.loadLevel('gnss');
    }

    initLevels() {
        this.levelsMap = {
            'gnss': new LevelGNSS(this),
            'leveling': new LevelLeveling(this),
            'gcp': new LevelGCP(this),
            'uav': new LevelUAV(this)
        };
    }

    initUIEvents() {
        const btnAudioToggle = document.getElementById('btn-audio-toggle');
        if (btnAudioToggle) {
            btnAudioToggle.onclick = (e) => {
                e.stopPropagation();
                this.isAudioMuted = !this.isAudioMuted;
                if (window.surveyAudio) {
                    window.surveyAudio.enabled = !this.isAudioMuted;
                    if (!this.isAudioMuted) window.surveyAudio.init();
                }
                btnAudioToggle.classList.toggle('is-off', this.isAudioMuted);
                const lbl = btnAudioToggle.querySelector('.hud-key-label');
                if (lbl) lbl.textContent = this.isAudioMuted ? '靜音中' : '聲音開';
            };
        }

        const btnHelp = document.getElementById('btn-help-guide');
        if (btnHelp) {
            btnHelp.onclick = (e) => {
                e.stopPropagation();
                if (document.exitPointerLock) document.exitPointerLock();
                const modal = document.getElementById('help-guide-modal');
                if (modal) modal.classList.add('show');
            };
        }

        const btnToggleMouse = document.getElementById('btn-toggle-mouse');
        if (btnToggleMouse) {
            btnToggleMouse.onclick = (e) => {
                e.stopPropagation();
                if (this.player.isLocked) {
                    if (document.exitPointerLock) document.exitPointerLock();
                } else {
                    const canvas = this.sceneManager.renderer.domElement;
                    if (canvas && !this.player.isModalOpen()) canvas.requestPointerLock();
                }
            };
        }

        // Restart full campaign button from Grand Summary modal
        const btnRestart = document.getElementById('btn-restart-campaign');
        if (btnRestart) {
            btnRestart.onclick = () => {
                this.closeAllModals();
                this.campaignResults = {};
                this.loadLevel('gnss');
            };
        }

        // Update pointer lock status badge in top HUD
        document.addEventListener('pointerlockchange', () => {
            const statusBadge = document.getElementById('mouse-lock-status');
            const toggleLbl = document.querySelector('#btn-toggle-mouse .hud-key-label');
            const locked = this.player.isLocked;
            if (statusBadge) {
                statusBadge.classList.toggle('is-locked', locked);
                statusBadge.textContent = locked ? '視角操作中 · Tab 釋放游標' : '游標已釋放 · 點擊畫面繼續';
            }
            if (toggleLbl) toggleLbl.textContent = locked ? '釋放游標' : '鎖定視角';
        });

        // Close modal buttons
        document.querySelectorAll('.modal-close-btn').forEach(btn => {
            btn.onclick = () => {
                const modal = btn.closest('.modal-backdrop');
                if (modal) modal.classList.remove('show');
                const tele = document.getElementById('telescope-overlay');
                if (tele) tele.classList.remove('active');
            };
        });

        // Initialize audio on first user click anywhere
        window.addEventListener('click', () => {
            if (window.surveyAudio) window.surveyAudio.init();
        }, { once: true });
    }

    openModal(modalId) {
        if (document.exitPointerLock) {
            document.exitPointerLock();
        }
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
        }
    }

    loadLevel(levelId) {
        if (this.currentLevelObj && this.currentLevelObj.stop) this.currentLevelObj.stop();
        if (this.currentLevelObj && this.currentLevelObj.id === 'uav') {
            this.player.setDroneMode(false);
            const hud = document.getElementById('drone-hud');
            if (hud) hud.classList.remove('active');
            // 離開飛行關卡時移除航線光柱、起降墊等 3D 物件
            if (this.currentLevelObj.clearFlightPathObjects) this.currentLevelObj.clearFlightPathObjects();
        }

        this.closeAllModals();
        this.currentLevelId = levelId;
        this.currentLevelObj = this.levelsMap[levelId];

        // 更新頂部任務導線：已完成 / 目前 / 未到
        this.updateTraverse();

        if (this.currentLevelObj) {
            this.currentLevelObj.start();
        }
    }

    updateTraverse() {
        document.querySelectorAll('#hud-level-indicator li').forEach(li => {
            const id = li.dataset.level;
            li.classList.toggle('current', id === this.currentLevelId);
            li.classList.toggle('done', !!this.campaignResults[id] && id !== this.currentLevelId);
            li.title = this.campaignResults[id] ? `已完成：${this.campaignResults[id].rank} 級` : '';
        });
    }

    handleInteraction(obj) {
        if (this.currentLevelObj && this.currentLevelObj.onInteract) {
            this.currentLevelObj.onInteract(obj);
        }
    }

    updateMissionPanel(title, tasks, activeStepIndex, hintText) {
        const titleEl = document.getElementById('mission-title');
        const listEl = document.getElementById('mission-task-list');
        const tipEl = document.getElementById('mission-tip-text');

        if (titleEl) titleEl.innerText = title;
        if (tipEl) tipEl.innerText = hintText || '依任務指引執行操作。';

        if (listEl && tasks) {
            listEl.innerHTML = '';
            tasks.forEach((t, i) => {
                const li = document.createElement('li');
                const isCompleted = t.id < activeStepIndex;
                const isActive = t.id === activeStepIndex;
                li.className = `task-item${isCompleted ? ' completed' : ''}${isActive ? ' active' : ''}`;
                const no = document.createElement('span');
                no.className = 'task-no';
                no.textContent = String(i + 1);
                const txt = document.createElement('span');
                txt.className = 'task-text';
                txt.innerHTML = t.text;
                li.append(no, txt);
                listEl.appendChild(li);
            });
        }
    }

    completeLevel(levelId, scoreData) {
        if (document.exitPointerLock) {
            document.exitPointerLock();
        }
        const rank = scoreData.rank || 'S';
        this.levelManager.saveProgress(levelId, rank);

        const modal = document.getElementById('level-complete-modal');
        if (!modal) return;

        // Level-specific feedback with requested S/A/B/C/F title style
        const levelSpecificFeedback = {
            'gnss': {
                'S': {
                    title: '衛星定位高手',
                    comment: '★ 成果卓越！三腳架光學對心達到亞毫米級、圓水準氣泡極致居中，天線斜儀高估讀分毫不差。1440 歷元載波相位資料完整無周跳，完全符合一等控制測量規範！★',
                    color: '#10b981',
                    bg: 'rgba(16, 185, 129, 0.15)'
                },
                'A': {
                    title: '衛星定位老手',
                    comment: '★ 成果優良！基座定心定平精度達標，天線量測與控制器歷元串流穩定，PDOP 幾何分佈良好，符合外業控制測量規範准予驗收！★',
                    color: '#06b6d4',
                    bg: 'rgba(6, 182, 212, 0.15)'
                },
                'B': {
                    title: '衛星定位學徒',
                    comment: '★ 尚可通關！基座定平或天線斜高估讀有微幅偏差，歷元解算精度堪用，建議進一步加強基座光學對心微調手感。★',
                    color: '#f59e0b',
                    bg: 'rgba(245, 158, 11, 0.15)'
                },
                'C': {
                    title: '退件重測',
                    comment: '⚠️ 成果超限退件！基座對心偏差或氣泡偏心殘差過大，斜高量測誤差將導致垂直坐標失真，監造工程師判定不合格，請重新架站！',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.2)'
                },
                'F': {
                    title: '廢點退件',
                    comment: '⚠️ 嚴重超限！定心定平嚴重走位，觀測資料無法進行載波相位基線解算，請重新定心定平後再次施測！',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.2)'
                }
            },
            'leveling': {
                'S': {
                    title: '水準測量專家',
                    comment: '★ 成果卓越！前後視距完全等長平衡（ΔD ≤ 0.5m），完美消除地球曲率與大氣折光誤差；望遠鏡中絲讀數判讀零誤差，扶尺圓氣泡穩如泰山，高程差計算 Δh 完全正確！★',
                    color: '#10b981',
                    bg: 'rgba(16, 185, 129, 0.15)'
                },
                'A': {
                    title: '水準測量熟手',
                    comment: '★ 成果優良！前後視距差控制在規範內，望遠鏡調焦清晰消除視差，扶尺抗風穩定度良好，水準路線高差閉合成果達標！★',
                    color: '#06b6d4',
                    bg: 'rgba(6, 182, 212, 0.15)'
                },
                'B': {
                    title: '水準測量學徒',
                    comment: '★ 尚可通關！架站前後視距差略大或扶尺氣泡有些許晃動，高差計算結果堪用，但仍建議選站時更注意前後等距原則。★',
                    color: '#f59e0b',
                    bg: 'rgba(245, 158, 11, 0.15)'
                },
                'C': {
                    title: '退件重測',
                    comment: '⚠️ 成果超限退件！前後視距嚴重失衡或扶尺氣泡傾斜超限，造成高程差計算殘差過大，不符合工程水準規範，請重新選站施測！',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.2)'
                },
                'F': {
                    title: '計算錯誤退件',
                    comment: '⚠️ 嚴重超限！外業高程差計算 Δh 錯誤或前後視讀數混淆，外業紀錄檢核不通過，請重新觀測與計算！',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.2)'
                }
            },
            'gcp': {
                'S': {
                    title: '佈標達人',
                    comment: '★ 成果卓越！1.2m 黑白航測標象限漆料均勻對比強烈、邊界無溢出；測量鋼釘 5 鎚鉛垂敲擊精準入地；3 張點誌記照片近景特寫無切邊、遠景清晰涵蓋周邊背景地物特徵，RTK 坐標建檔完美！★',
                    color: '#10b981',
                    bg: 'rgba(16, 185, 129, 0.15)'
                },
                'A': {
                    title: '佈標好手',
                    comment: '★ 成果優良！航測標漆面反差良好，測量鋼釘敲擊垂直度合格，遠近 3 張照片取景符合航測空三解算查核標準，准予建檔！★',
                    color: '#06b6d4',
                    bg: 'rgba(6, 182, 212, 0.15)'
                },
                'B': {
                    title: '佈標學徒',
                    comment: '★ 尚可通關！漆面邊緣稍有塗抹溢出或鋼釘有些微傾角，現場照片尚能辨識點位，建議未來噴塗更注意邊界分明。★',
                    color: '#f59e0b',
                    bg: 'rgba(245, 158, 11, 0.15)'
                },
                'C': {
                    title: '退件重測',
                    comment: '⚠️ 成果超限退件！黑白象限覆蓋不足、鋼釘偏心傾斜過大，或現場遠景照片未拍到周邊參考特徵地物，航測空三將無法自動辨識！',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.2)'
                },
                'F': {
                    title: '標誌廢棄退件',
                    comment: '⚠️ 嚴重不合格！航測標噴塗嚴重錯色且鋼釘歪斜，無法作為航空攝影測量之地面控制點，請重新鋪設噴塗！',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.2)'
                }
            },
            'uav': {
                'S': {
                    title: '專業飛手',
                    comment: '★ 飛行卓越！全程保持 20m 黃金作業航高與航線走廊零偏離；4 組航拍照片完美捕捉地面手繪航測標正射中心；在緊急低電量下從容手動操縱、絲毫不差精準落入起降場 Home 點！★',
                    color: '#10b981',
                    bg: 'rgba(16, 185, 129, 0.15)'
                },
                'A': {
                    title: '熟練飛手',
                    comment: '★ 飛行良好！航高與航線維持穩定，4 張航測照片曝光清晰且包含地面標誌，安全平穩降落起降場，正射影像產製資料完備！★',
                    color: '#06b6d4',
                    bg: 'rgba(6, 182, 212, 0.15)'
                },
                'B': {
                    title: '業餘飛手',
                    comment: '★ 尚可通關！巡航時航高有些微起伏或航線稍有偏移，降落點有些許偏離起降場中心，航測相片尚足夠空三拼接建模。★',
                    color: '#f59e0b',
                    bg: 'rgba(245, 158, 11, 0.15)'
                },
                'C': {
                    title: '航拍重飛',
                    comment: '⚠️ 成果超限退件！巡航航高偏離過多或航拍照相未對準地面標誌，照片曝光品質低落導致空三特徵點不足，請重新起飛施測！',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.2)'
                },
                'F': {
                    title: '迫降失敗',
                    comment: '⚠️ 任務失敗！航線嚴重偏離、照片遺漏地面航測標，或著陸嚴重偏離起降場，外業成果全數作廢，請重新飛行！',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.2)'
                }
            }
        };

        const currentLvlDict = levelSpecificFeedback[levelId] || levelSpecificFeedback['gnss'];
        const fb = currentLvlDict[rank] || currentLvlDict['C'];

        // Record level score into campaign results
        this.campaignResults[levelId] = {
            score: typeof scoreData.score === 'number' ? scoreData.score : 85,
            rank: rank,
            title: fb.title,
            color: fb.color,
            levelTitle: this.currentLevelObj ? this.currentLevelObj.title : levelId
        };

        this.updateTraverse();

        document.getElementById('complete-level-title').innerText = `${this.currentLevelObj ? this.currentLevelObj.title : '關卡'} 完成！`;
        
        const rankElem = document.getElementById('complete-rank');
        if (rankElem) {
            rankElem.innerText = `${rank} 級 [${fb.title}]`;
            rankElem.style.color = fb.color;
        }

        const commentElem = document.getElementById('complete-feedback-comment');
        if (commentElem) {
            commentElem.innerText = fb.comment;
            commentElem.style.color = fb.color;
            commentElem.style.background = fb.bg;
            commentElem.style.border = `1px solid ${fb.color}`;
        }

        const table = document.getElementById('complete-details-table');
        if (table && scoreData.details) {
            table.innerHTML = '';
            scoreData.details.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${row.label}</td><td>${row.value}</td>`;
                table.appendChild(tr);
            });
        }

        modal.classList.add('show');

        // Next level button (linear campaign flow)
        const btnNext = document.getElementById('btn-next-level');
        if (btnNext) {
            const currentIdx = this.levelSequence.indexOf(levelId);
            const isLastLevel = (currentIdx === this.levelSequence.length - 1);

            if (isLastLevel) {
                btnNext.innerHTML = '🏆 查看全能總成果評定 (Grand Evaluation)';
                btnNext.onclick = () => {
                    modal.classList.remove('show');
                    this.showGrandSummaryModal();
                };
            } else {
                const nextLevelId = this.levelSequence[currentIdx + 1];
                const nextNames = {
                    'leveling': '任務 2: 一等精密水準測量',
                    'gcp': '任務 3: 航測對空標誌 (GCP) 佈設',
                    'uav': '任務 4: 無人機航拍攝影測量'
                };
                btnNext.innerHTML = `▶ 進入下一任務 (${nextNames[nextLevelId] || nextLevelId})`;
                btnNext.onclick = () => {
                    modal.classList.remove('show');
                    this.loadLevel(nextLevelId);
                };
            }
        }
    }

    showGrandSummaryModal() {
        if (document.exitPointerLock) document.exitPointerLock();

        const grandModal = document.getElementById('grand-summary-modal');
        if (!grandModal) return;

        // Calculate average score across all 4 levels
        const levelKeys = ['gnss', 'leveling', 'gcp', 'uav'];
        let totalScore = 0;
        let validLevels = 0;

        levelKeys.forEach(k => {
            if (this.campaignResults[k]) {
                totalScore += this.campaignResults[k].score;
                validLevels++;
            }
        });

        const avgScore = validLevels > 0 ? Math.round(totalScore / validLevels) : 90;

        // Supreme titles for overall campaign
        let grandRank = 'S';
        let grandTitle = '外業組長';
        let grandColor = '#10b981';
        let grandBg = 'rgba(16, 185, 129, 0.15)';
        let grandComment = '🌟【外業組長】恭喜通過全部四大測量外業嚴格檢定！無論是高精度 GNSS 靜態觀測、一等水準前後視距平衡、航測對空標誌精準佈設，或是無人機空三正射航拍均達到頂尖水準，可以獨當一面帶隊出外業了！';

        if (avgScore >= 90) {
            grandRank = 'S';
            grandTitle = '外業組長';
            grandColor = '#10b981';
            grandBg = 'rgba(16, 185, 129, 0.15)';
            grandComment = '🌟【外業組長】恭喜通過全部四大測量外業嚴格檢定！無論是高精度 GNSS 靜態觀測、一等水準前後視距平衡、航測對空標誌精準佈設，或是無人機空三正射航拍均達到頂尖水準，可以獨當一面帶隊出外業了！';
        } else if (avgScore >= 80) {
            grandRank = 'A';
            grandTitle = '工程師';
            grandColor = '#06b6d4';
            grandBg = 'rgba(6, 182, 212, 0.15)';
            grandComment = '🥇【工程師】四項測量外業技能均穩定達標，外業觀測精度良好、數據記錄完整，各項成果符合工程測量規範准予驗收！';
        } else if (avgScore >= 65) {
            grandRank = 'B';
            grandTitle = '助理工程師';
            grandColor = '#f59e0b';
            grandBg = 'rgba(245, 158, 11, 0.15)';
            grandComment = '🥈【助理工程師】四大任務皆順利完成，具備獨立執行各項外業施測基礎能力，若再提升細節微調精度將更臻完美！';
        } else {
            grandRank = 'C';
            grandTitle = '工讀生';
            grandColor = '#ef4444';
            grandBg = 'rgba(239, 68, 68, 0.2)';
            grandComment = '🥉【工讀生】部分項目外業殘差超出工程規範，建議重新研讀測量實務手冊並重新挑戰整輪外業訓練！';
        }

        const rankEl = document.getElementById('grand-final-rank');
        if (rankEl) {
            rankEl.innerText = `${grandRank} 級 (${avgScore} 分)`;
            rankEl.style.color = grandColor;
        }

        const titleEl = document.getElementById('grand-final-title');
        if (titleEl) {
            titleEl.innerText = `總評等稱號：【 ${grandTitle} 】`;
            titleEl.style.color = grandColor;
        }

        const commentEl = document.getElementById('grand-final-comment');
        if (commentEl) {
            commentEl.innerText = grandComment;
            commentEl.style.color = grandColor;
            commentEl.style.background = grandBg;
            commentEl.style.border = `1px solid ${grandColor}`;
        }

        const table = document.getElementById('grand-details-table');
        if (table) {
            table.innerHTML = '';
            const names = [
                { id: 'gnss', label: '關卡 1: GNSS 靜態定位測量' },
                { id: 'leveling', label: '關卡 2: 一等精密水準測量' },
                { id: 'gcp', label: '關卡 3: 航測對空標誌 (GCP) 佈設' },
                { id: 'uav', label: '關卡 4: 無人機航拍攝影測量' }
            ];

            names.forEach(item => {
                const res = this.campaignResults[item.id] || { score: 85, rank: 'A', title: '合格', color: '#06b6d4' };
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:700; color:#fff;">${item.label}</td>
                    <td style="font-family:var(--font-mono); color:${res.color}; font-weight:700;">
                        ${res.score} 分 [${res.rank} 級: ${res.title}]
                    </td>
                `;
                table.appendChild(tr);
            });

            // Grand Total Average Row
            const totalTr = document.createElement('tr');
            totalTr.style.background = 'rgba(255,255,255,0.05)';
            totalTr.style.borderTop = '2px solid #334155';
            totalTr.innerHTML = `
                <td style="font-weight:800; color:var(--accent-yellow); font-size:14px;">🎯 四大任務綜合總評定</td>
                <td style="font-family:var(--font-mono); font-weight:800; color:${grandColor}; font-size:14px;">
                    平均 ${avgScore} 分 [${grandRank} 級: ${grandTitle}]
                </td>
            `;
            table.appendChild(totalTr);
        }

        if (window.surveyAudio) window.surveyAudio.playSuccessChime();
        grandModal.classList.add('show');
    }

    closeAllModals() {
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('show'));
        const tele = document.getElementById('telescope-overlay');
        if (tele) tele.classList.remove('active');
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        // Update player & physics
        this.player.update(delta);

        // Update active level logic (e.g. UAV flight telemetry)
        if (this.currentLevelObj && this.currentLevelObj.update) {
            this.currentLevelObj.update(delta);
        }

        // Render 3D scene
        this.sceneManager.render();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.gameApp = new SurveyorGameApp();
});
