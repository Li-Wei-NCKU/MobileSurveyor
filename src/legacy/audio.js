/**
 * Surveyor Sound Engine (Web Audio API)
 * Procedural audio synthesis for realistic survey instruments, environment, and UI.
 */
class SurveyAudio {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.ambientGain = null;
        this.droneOscillators = [];
        this.droneGain = null;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.initialized = true;
            this.startAmbient();
        } catch (e) {
            console.warn("Web Audio API not supported", e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    startAmbient() {
        if (!this.ctx || this.ambientGain) return;
        // Subtle outdoor wind noise generator
        const bufferSize = this.ctx.sampleRate * 2;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const whiteNoise = this.ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, this.ctx.currentTime);
        filter.Q.setValueAtTime(3, this.ctx.currentTime);

        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.setValueAtTime(0.04, this.ctx.currentTime);

        whiteNoise.connect(filter);
        filter.connect(this.ambientGain);
        this.ambientGain.connect(this.ctx.destination);
        whiteNoise.start(0);
    }

    playClick() {
        if (!this.ctx || !this.enabled) return;
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 0.04);

        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.05);
    }

    playScrewRotate() {
        if (!this.ctx || !this.enabled) return;
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240 + Math.random() * 60, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(180, this.ctx.currentTime + 0.08);

        gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.09);
    }

    playLaserBeep() {
        if (!this.ctx || !this.enabled) return;
        this.resume();
        const now = this.ctx.currentTime;
        [0, 0.1, 0.2].forEach((offset, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(2200, now + offset);

            gain.gain.setValueAtTime(0, now + offset);
            gain.gain.linearRampToValueAtTime(0.15, now + offset + 0.01);
            gain.gain.linearRampToValueAtTime(0, now + offset + 0.05);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.06);
        });
    }

    playEDMLock() {
        if (!this.ctx || !this.enabled) return;
        this.resume();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(2400, now + 0.18);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.26);
    }

    playSuccessChime() {
        if (!this.ctx || !this.enabled) return;
        this.resume();
        const now = this.ctx.currentTime;
        const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        freqs.forEach((f, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, now + i * 0.08);

            gain.gain.setValueAtTime(0.2, now + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.4);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.45);
        });
    }

    playCameraShutter() {
        if (!this.ctx || !this.enabled) return;
        this.resume();
        const now = this.ctx.currentTime;
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(1400, now);
        gain1.gain.setValueAtTime(0.3, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc1.connect(gain1);
        gain1.connect(this.ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.05);

        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(900, now + 0.07);
        gain2.gain.setValueAtTime(0.2, now + 0.07);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);
        osc2.start(now + 0.07);
        osc2.stop(now + 0.13);
    }

    playSprayPaint() {
        if (!this.ctx || !this.enabled) return;
        this.resume();
        const now = this.ctx.currentTime;
        const bufferSize = this.ctx.sampleRate * 0.15;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = (Math.random() * 2 - 1);
        }
        const whiteNoise = this.ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2800, now);
        filter.Q.setValueAtTime(2, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

        whiteNoise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        whiteNoise.start(now);
    }

    playHammer() {
        if (!this.ctx || !this.enabled) return;
        this.resume();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(450, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
    }

    startDroneMotor() {
        if (!this.ctx || !this.enabled || this.droneGain) return;
        this.resume();
        this.droneGain = this.ctx.createGain();
        this.droneGain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        this.droneGain.connect(this.ctx.destination);

        const freqs = [180, 184, 360, 540];
        this.droneOscillators = freqs.map((f, i) => {
            const osc = this.ctx.createOscillator();
            osc.type = i < 2 ? 'sawtooth' : 'sine';
            osc.frequency.setValueAtTime(f, this.ctx.currentTime);
            osc.connect(this.droneGain);
            osc.start();
            return osc;
        });
    }

    updateDroneThrottle(throttleRatio) {
        if (!this.ctx || !this.droneGain || this.droneOscillators.length === 0) return;
        const baseFreq = 160 + throttleRatio * 140;
        const freqs = [baseFreq, baseFreq * 1.02, baseFreq * 2, baseFreq * 3];
        this.droneOscillators.forEach((osc, i) => {
            osc.frequency.setTargetAtTime(freqs[i], this.ctx.currentTime, 0.05);
        });
        const volume = 0.05 + throttleRatio * 0.08;
        this.droneGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }

    stopDroneMotor() {
        if (!this.droneGain) return;
        this.droneOscillators.forEach(osc => {
            try { osc.stop(); osc.disconnect(); } catch (e) { }
        });
        this.droneOscillators = [];
        try { this.droneGain.disconnect(); } catch (e) { }
        this.droneGain = null;
    }
}

window.surveyAudio = new SurveyAudio();
