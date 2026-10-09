/**
 * Level Selection & Progress Manager
 * Handles level metadata, unlocking, progress saving/loading (localStorage), and score tracking.
 */
class LevelSelectManager {
    constructor(gameApp) {
        this.app = gameApp;
        this.levels = [
            {
                id: 'gnss',
                title: '關卡 1: GNSS 靜態定位測量',
                desc: '在已知一等衛星控制點架設三腳架，完成基座腳螺旋定平、光學對心、量測天線斜高與外業手簿 1440 歷元靜態觀測。',
                tag: '衛星大地測量',
                icon: '🛰️',
                completed: false,
                rank: '-'
            },
            {
                id: 'leveling',
                title: '關卡 2: 一等精密水準測量',
                desc: '於兩水準點間自主選站架設水準儀，檢核前後視距等長平衡，望遠鏡調焦消除視差並讀數，扶正前視水準尺氣泡，計算高程差 Δh。',
                tag: '高程精密控制',
                icon: '📏',
                completed: false,
                rank: '-'
            },
            {
                id: 'gcp',
                title: '關卡 3: 航測對空標誌 (GCP) 佈設',
                desc: '在開闊地形選點鋪設 1.2m 航測對空十字標樣板，噴塗黑白高反差工程漆，敲入測量鋼釘並以 RTK 採集毫米級坐標與點誌記照片。',
                tag: '航測外業工程',
                icon: '🎯',
                completed: false,
                rank: '-'
            },
            {
                id: 'uav',
                title: '關卡 4: 無人機航拍攝影測量',
                desc: '第一人稱 FPV 操縱無人機起飛至 20m 作業航高，依序巡航 WP-01 至 WP-04 航拍地面標誌正射影像，並於低電量時安全迫降於起降場。',
                tag: '無人機空間資訊',
                icon: '🚁',
                completed: false,
                rank: '-'
            }
        ];

        this.loadProgress();
    }

    loadProgress() {
        try {
            const saved = localStorage.getItem('surveyor_game_progress');
            if (saved) {
                const data = JSON.parse(saved);
                this.levels.forEach(lvl => {
                    if (data[lvl.id]) {
                        lvl.completed = data[lvl.id].completed;
                        lvl.rank = data[lvl.id].rank;
                    }
                });
            }
        } catch (e) {
            console.warn("Could not load local progress", e);
        }
    }

    saveProgress(levelId, rank) {
        try {
            const lvl = this.levels.find(l => l.id === levelId);
            if (lvl) {
                lvl.completed = true;
                lvl.rank = rank;
            }
            const data = {};
            this.levels.forEach(l => {
                data[l.id] = { completed: l.completed, rank: l.rank };
            });
            localStorage.setItem('surveyor_game_progress', JSON.stringify(data));
        } catch (e) {
            console.warn("Could not save progress", e);
        }
    }

    renderLevelCards() {
        const grid = document.getElementById('level-cards-grid');
        if (!grid) return;

        grid.innerHTML = '';
        this.levels.forEach((lvl, idx) => {
            const card = document.createElement('div');
            card.className = 'level-card';
            card.onclick = () => {
                this.app.loadLevel(lvl.id);
                this.closeLevelModal();
            };

            const colors = ['#0284c7', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
            const bgGrad = `linear-gradient(135deg, ${colors[idx % colors.length]} 0%, #111827 100%)`;

            const rankTitles = {
                'gnss': { 'S': '衛星定位高手', 'A': '衛星定位老手', 'B': '衛星定位學徒', 'C': '退件重測', 'F': '廢點退件' },
                'leveling': { 'S': '水準測量專家', 'A': '水準測量熟手', 'B': '水準測量學徒', 'C': '退件重測', 'F': '計算錯誤退件' },
                'gcp': { 'S': '佈標達人', 'A': '佈標好手', 'B': '佈標學徒', 'C': '退件重測', 'F': '標誌廢棄退件' },
                'uav': { 'S': '專業飛手', 'A': '熟練飛手', 'B': '業餘飛手', 'C': '航拍重飛', 'F': '迫降失敗' }
            };
            const lvlRankDict = rankTitles[lvl.id] || {};
            const rankLabel = lvl.completed ? `${lvl.rank} 級 (${lvlRankDict[lvl.rank] || '已驗收'})` : '未施測';

            card.innerHTML = `
                <div class="level-card-img" style="background: ${bgGrad};">
                    <span class="level-tag">${lvl.tag}</span>
                </div>
                <div class="level-card-body">
                    <div>
                        <h4>${lvl.icon} ${lvl.title}</h4>
                        <p>${lvl.desc}</p>
                    </div>
                    <div class="level-meta">
                        <span style="color: ${lvl.completed ? '#10b981' : '#9ca3af'}">
                            ${lvl.completed ? '✓ 已通關' : '○ 未通關'}
                        </span>
                        <span class="badge-score">${rankLabel}</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    openLevelModal() {
        this.renderLevelCards();
        this.app.openModal('level-select-modal');
    }

    closeLevelModal() {
        this.app.closeModal('level-select-modal');
    }
}

window.LevelSelectManager = LevelSelectManager;
