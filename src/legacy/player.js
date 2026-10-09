/**
 * First-Person Player Controller & Drone Flight Controller
 * Handles WASD movement, mouse look (PointerLock), raycasting interaction, and drone FPV flight.
 */
class SurveyPlayer {
    constructor(surveyScene, onInteractCallback) {
        this.surveyScene = surveyScene;
        this.camera = surveyScene.camera;
        this.onInteract = onInteractCallback;

        // Player physical state
        this.position = new THREE.Vector3(0, 1.65, 5); // eye level 1.65m
        this.velocity = new THREE.Vector3();
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.isLocked = false;
        this.moveSpeed = 4.5;
        this.sprintMultiplier = 1.6;

        // Input state
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            sprint: false,
            jump: false,
            droneUp: false,
            droneDown: false
        };

        // Raycasting for interaction
        this.raycaster = new THREE.Raycaster();
        this.crosshairRay = new THREE.Vector2(0, 0); // center of screen
        this.hoveredObject = null;

        // Drone Mode
        this.isDroneMode = false;
        this.isEmergencyLanding = false;
        this.dronePosition = new THREE.Vector3(0, 1.5, 0);
        this.droneRotation = new THREE.Euler(0, 0, 0, 'YXZ');
        this.droneVelocity = new THREE.Vector3();
        this.droneSpeed = 6.0;
        this.gimbalPitch = -0.3; // camera look down angle in rad

        this.initControls();
    }

    initControls() {
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));

        // Pointer Lock canvas request
        const canvas = this.surveyScene.renderer.domElement;
        canvas.addEventListener('click', () => {
            if (!this.isLocked && !this.isModalOpen()) {
                canvas.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === canvas;
        });
    }

    isModalOpen() {
        return document.querySelectorAll('.modal-backdrop.show, #telescope-overlay.active').length > 0;
    }

    onKeyDown(e) {
        if (this.isModalOpen()) {
            if (e.key === 'Escape') {
                if (window.gameApp) window.gameApp.closeAllModals();
            }
            return;
        }

        // 新系統的額外按鍵 (G 放下物品等)
        if (window.gameApp && window.gameApp.onExtraKey && window.gameApp.onExtraKey(e)) return;

        // Global UI shortcuts
        if (false && (e.code === 'KeyM' || e.code === 'KeyL')) { // 練習模式已移除，不再開關卡選單
            if (window.gameApp && window.gameApp.levelManager) {
                if (document.exitPointerLock) document.exitPointerLock();
                window.gameApp.levelManager.openLevelModal();
                return;
            }
        }
        if (e.code === 'KeyV' && this.isDroneMode) {
            this.droneChaseCam = !this.droneChaseCam;
            if (this.droneChaseCam) this.camera.layers.enable(1); else this.camera.layers.disable(1);
            return;
        }

        if (e.code === 'KeyH') {
            if (document.exitPointerLock) document.exitPointerLock();
            const modal = document.getElementById('help-guide-modal');
            if (modal) modal.classList.add('show');
            return;
        }
        if (e.code === 'KeyT') {
            const btnAudioToggle = document.getElementById('btn-audio-toggle');
            if (btnAudioToggle) btnAudioToggle.click();
            return;
        }
        if (e.code === 'Tab' || e.code === 'AltLeft' || e.code === 'AltRight') {
            e.preventDefault();
            if (this.isLocked) {
                if (document.exitPointerLock) document.exitPointerLock();
            } else {
                const canvas = this.surveyScene.renderer.domElement;
                if (canvas && !this.isModalOpen()) canvas.requestPointerLock();
            }
            return;
        }

        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.keys.forward = true;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.keys.backward = true;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.keys.left = true;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.keys.right = true;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.sprint = true;
                break;
            case 'Space':
                if (this.isDroneMode) {
                    if (window.gameApp && window.gameApp.currentLevelObj && window.gameApp.currentLevelObj.onDroneShutter) {
                        window.gameApp.currentLevelObj.onDroneShutter();
                    }
                } else {
                    this.keys.jump = true;
                }
                break;
            case 'KeyE':
                if (this.isDroneMode) {
                    this.keys.droneUp = true;
                } else {
                    this.triggerInteraction();
                }
                break;
            case 'KeyQ':
                if (this.isDroneMode) {
                    this.keys.droneDown = true;
                }
                break;
            case 'KeyC':
                if (this.isDroneMode) {
                    this.gimbalPitch = this.gimbalPitch < -1.4 ? -0.2 : this.gimbalPitch - 0.3;
                }
                break;
        }
    }

    onKeyUp(e) {
        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.keys.forward = false;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.keys.backward = false;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.keys.left = false;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.keys.right = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.sprint = false;
                break;
            case 'Space':
                this.keys.jump = false;
                break;
            case 'KeyE':
                this.keys.droneUp = false;
                break;
            case 'KeyQ':
                this.keys.droneDown = false;
                break;
        }
    }



    triggerInteraction() {
        if (this.hoveredObject && this.onInteract) {
            this.onInteract(this.hoveredObject);
        } else if (window.gameApp && window.gameApp.currentLevelObj && window.gameApp.currentLevelObj.onFreeInteract) {
            window.gameApp.currentLevelObj.onFreeInteract(this.position);
        }
    }

    updateRaycast() {
        if (this.isDroneMode || this.isModalOpen()) {
            this.hoveredObject = null;
            this.hidePrompt();
            return;
        }

        this.raycaster.setFromCamera(this.crosshairRay, this.camera);
        const intersects = this.raycaster.intersectObjects(this.surveyScene.interactiveObjects, true);

        const promptEl = document.getElementById('interaction-prompt');
        const crosshairEl = document.getElementById('reticle-crosshair');

        if (intersects.length > 0 && intersects[0].distance < 4.5) {
            let hit = intersects[0].object;
            while (hit.parent && !hit.userData.type && hit.parent !== this.surveyScene.scene) {
                hit = hit.parent;
            }

            if (hit.userData && hit.userData.type) {
                // Strict check: Only treat object as interactable IF active level provides a prompt for the CURRENT step!
                let dynamicAction = null;
                if (window.gameApp && window.gameApp.currentLevelObj && window.gameApp.currentLevelObj.getInteractionPrompt) {
                    dynamicAction = window.gameApp.currentLevelObj.getInteractionPrompt(hit);
                }

                if (dynamicAction) {
                    this.hoveredObject = hit;
                    if (crosshairEl) crosshairEl.classList.add('active');
                    if (promptEl) {
                        promptEl.innerHTML = `<kbd class="cap cap-accent">E</kbd><span class="prompt-text">${dynamicAction}</span>`;
                        promptEl.style.display = 'flex';
                    }
                    return;
                }
            }
        }

        this.hoveredObject = null;

        // Check if the active level supports free ground interaction (e.g. choosing setup point freely in Level 2 Step 0)
        if (window.gameApp && window.gameApp.currentLevelObj && window.gameApp.currentLevelObj.getFreeInteractPrompt) {
            const freePrompt = window.gameApp.currentLevelObj.getFreeInteractPrompt(this.position);
            if (freePrompt) {
                if (crosshairEl) crosshairEl.classList.add('active');
                if (promptEl) {
                    promptEl.innerHTML = `<kbd class="cap cap-accent">E</kbd><span class="prompt-text">${freePrompt}</span>`;
                    promptEl.style.display = 'flex';
                }
                return;
            }
        }

        if (crosshairEl) crosshairEl.classList.remove('active');
        this.hidePrompt();
    }

    hidePrompt() {
        const promptEl = document.getElementById('interaction-prompt');
        if (promptEl) promptEl.style.display = 'none';
    }

    setDroneMode(enabled, startPos = null) {
        this.isDroneMode = enabled;
        if (enabled) {
            this.dronePosition.copy(startPos || new THREE.Vector3(0, 2.5, 0));
            this.droneRotation.set(0, 0, 0);
            this.gimbalPitch = -0.55; // Default tilted downwards facing ground targets
            if (window.surveyAudio) window.surveyAudio.startDroneMotor();
        } else {
            if (window.surveyAudio) window.surveyAudio.stopDroneMotor();
            this.droneChaseCam = false;
            this.camera.layers.disable(1);
            this.camera.quaternion.setFromEuler(this.euler);
        }
    }

    update(delta) {
        // 外部控制 (例如駕駛車輛時由外業系統接管)
        if (this.externalControl) {
            this.externalControl(delta);
            return;
        }
        if (this.isDroneMode) {
            this.updateDroneFlight(delta);
        } else {
            this.updateWalking(delta);
            this.updateRaycast();
        }
    }

    updateWalking(delta) {
        const speed = this.moveSpeed * (this.carrySpeedFactor || 1) * ((this.keys.sprint && !this.noSprint) ? this.sprintMultiplier : 1.0);
        const moveDir = new THREE.Vector3();

        if (this.keys.forward) moveDir.z -= 1;
        if (this.keys.backward) moveDir.z += 1;
        if (this.keys.left) moveDir.x -= 1;
        if (this.keys.right) moveDir.x += 1;

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
            // Rotate move direction to face current yaw
            moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.euler.y);
            this.position.addScaledVector(moveDir, speed * delta);
        }

        // 貼地 (眼高 1.65m)
        const gh = this.surveyScene.heightAt ? this.surveyScene.heightAt(this.position.x, this.position.z) : 0;
        this.position.y = gh + 1.65;
        this.camera.position.copy(this.position);
    }

    onMouseMove(e) {
        if (!this.isLocked || this.isModalOpen()) return;

        const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
        const movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;

        const sensitivity = 0.0022;

        if (this.isDroneMode) {
            this.droneRotation.y -= movementX * sensitivity;
            this.droneRotation.x -= movementY * sensitivity;
            // Allow looking from straight down (-90 deg) up to +45 deg
            this.droneRotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 4, this.droneRotation.x));
        } else {
            this.euler.y -= movementX * sensitivity;
            this.euler.x -= movementY * sensitivity;
            this.euler.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.euler.x));
            this.camera.quaternion.setFromEuler(this.euler);
        }
    }

    updateDroneFlight(delta) {
        const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, this.droneRotation.y, 0));
        const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, this.droneRotation.y, 0));

        let throttle = 0;
        if (this.keys.forward) { this.dronePosition.addScaledVector(forward, this.droneSpeed * delta); throttle += 0.3; }
        if (this.keys.backward) { this.dronePosition.addScaledVector(forward, -this.droneSpeed * delta); throttle += 0.2; }
        if (this.keys.left) { this.dronePosition.addScaledVector(right, -this.droneSpeed * delta); throttle += 0.2; }
        if (this.keys.right) { this.dronePosition.addScaledVector(right, this.droneSpeed * delta); throttle += 0.2; }

        if (this.isEmergencyLanding) {
            // Auto forced descent (~1.6 m/s) when battery < 20%, vertical climb is locked
            this.dronePosition.y = Math.max(0.1, this.dronePosition.y - 1.6 * delta);
            throttle += 0.4;
        } else {
            if (this.keys.droneUp) { this.dronePosition.y += this.droneSpeed * 0.8 * delta; throttle += 0.5; }
            if (this.keys.droneDown) { this.dronePosition.y = Math.max(0.5, this.dronePosition.y - this.droneSpeed * 0.8 * delta); throttle += 0.1; }
        }

        // Audio pitch response
        if (window.surveyAudio) window.surveyAudio.updateDroneThrottle(Math.min(1.0, throttle + 0.15));

        // Synchronize 3D drone mesh
        if (this.surveyScene.droneModel) {
            this.surveyScene.droneModel.position.copy(this.dronePosition);
            this.surveyScene.droneModel.rotation.y = this.droneRotation.y;
            this.surveyScene.droneModel.rotation.x = this.droneRotation.x * 0.4;
            this.surveyScene.updateDronePropellers(delta);
        }

        // 雲台相機俯仰同步至 3D 模型
        if (this.surveyScene.droneModel && this.surveyScene.droneModel.userData.gimbalTilt) {
            this.surveyScene.droneModel.userData.gimbalTilt.rotation.x = this.gimbalPitch + this.droneRotation.x * 0.6;
        }

        const camEuler = new THREE.Euler(this.droneRotation.x + this.gimbalPitch, this.droneRotation.y, 0, 'YXZ');
        if (this.droneChaseCam) {
            // 第三人稱追蹤視角 (V 鍵切換)：可欣賞無人機模型
            const back = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, this.droneRotation.y, 0));
            const desired = this.dronePosition.clone().addScaledVector(back, 2.6).add(new THREE.Vector3(0, 1.1, 0));
            desired.y = Math.max(0.6, desired.y);
            if (!this._chaseInit) { this.camera.position.copy(desired); this._chaseInit = true; }
            this.camera.position.lerp(desired, Math.min(1, delta * 6));
            const look = this.dronePosition.clone().add(new THREE.Vector3(0, -0.15, 0)).addScaledVector(back, -1.2);
            this.camera.lookAt(look);
        } else {
            this._chaseInit = false;
            // Camera matches drone FPV perspective
            this.camera.position.copy(this.dronePosition).add(new THREE.Vector3(0, 0.05, 0));
            this.camera.quaternion.setFromEuler(camEuler);
        }
    }

    /** 雲台相機實際指向 (與畫面視角無關，供航拍評分使用) */
    getDroneCameraDirection() {
        const e = new THREE.Euler(this.droneRotation.x + this.gimbalPitch, this.droneRotation.y, 0, 'YXZ');
        return new THREE.Vector3(0, 0, -1).applyEuler(e);
    }
}

window.SurveyPlayer = SurveyPlayer;
