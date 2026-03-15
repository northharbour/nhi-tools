// Geiger Counter PWA - Main Application Logic
// Uses: Bandpass Filter → Envelope Follower → Sample-level Peak Detection
class GeigerCounter {
    constructor() {
        // Audio nodes
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.bandpassFilter = null;
        this.gainNode = null;
        this.scriptProcessor = null;
        this.uiUpdateInterval = null;
        this.isListening = false;

        // Detection parameters
        this.targetFrequency = 4266; // Hz
        this.sensitivity = 0.3; // 0-1
        this.bandWidth = 400; // Hz total bandwidth of the bandpass filter

        // Counter state
        this.counts = 0;
        this.startTime = 0;
        this.peakCps = 0;

        // For 1-second averaging
        this.countsInWindow = [];

        // Envelope follower state (runs at sample rate)
        this.envelope = 0;
        this.attackCoeff = 0;
        this.releaseCoeff = 0;
        this.inPulse = false;
        this.samplesSinceLastPulse = 0;
        this.minPulseSamples = 0;

        // Visualization buffer (latest filtered signal snapshot)
        this.vizBuffer = new Float32Array(512);
        this.vizEnvelopeBuffer = new Float32Array(512);
        this.vizThreshold = 0;

        // DOM elements
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.cpsDisplay = document.getElementById('cpsDisplay');
        this.cpmDisplay = document.getElementById('cpmDisplay');
        this.totalDisplay = document.getElementById('totalDisplay');
        this.peakCpsDisplay = document.getElementById('peakCps');
        this.uptimeDisplay = document.getElementById('uptime');
        this.statusText = document.getElementById('statusText');
        this.statusDot = document.getElementById('statusDot');
        this.statusMessage = document.getElementById('statusMessage');
        this.canvas = document.getElementById('frequencyCanvas');
        this.canvasCtx = this.canvas.getContext('2d');

        // Sliders
        this.sensitivitySlider = document.getElementById('sensitivitySlider');
        this.frequencyInput = document.getElementById('frequencyInput');
        this.beepDurationSlider = document.getElementById('beepDurationSlider');

        this.init();
    }

    init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            if (!this.isListening) this.drawCanvas();
        });
        this.attachEventListeners();
        this.drawCanvas();
    }

    resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width || 300;
        const h = rect.height || 150;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cssWidth = w;
        this.cssHeight = h;
    }

    attachEventListeners() {
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.resetBtn.addEventListener('click', () => this.reset());

        this.sensitivitySlider.addEventListener('input', (e) => {
            this.sensitivity = parseInt(e.target.value) / 100;
            document.getElementById('sensitivityValue').textContent = e.target.value + '%';
        });

        this.frequencyInput.addEventListener('change', (e) => {
            const kHz = parseFloat(e.target.value);
            if (!isNaN(kHz) && kHz > 0) {
                this.targetFrequency = kHz * 1000;
                if (this.bandpassFilter) {
                    this.bandpassFilter.frequency.value = this.targetFrequency;
                }
            }
        });

        this.beepDurationSlider.addEventListener('input', (e) => {
            this.bandWidth = parseInt(e.target.value);
            document.getElementById('beepDurationValue').textContent = e.target.value + ' Hz';
            if (this.bandpassFilter) {
                this.bandpassFilter.Q.value = this.targetFrequency / this.bandWidth;
            }
        });
    }

    async start() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            const sampleRate = this.audioContext.sampleRate;

            // === Audio Graph ===
            // Mic → BandpassFilter → Gain(50x) → ScriptProcessor → (silence)
            // Mic → Analyser (for frequency viz)

            this.microphone = this.audioContext.createMediaStreamSource(stream);

            // Bandpass filter centered on target frequency
            this.bandpassFilter = this.audioContext.createBiquadFilter();
            this.bandpassFilter.type = 'bandpass';
            this.bandpassFilter.frequency.value = this.targetFrequency;
            this.bandpassFilter.Q.value = this.targetFrequency / this.bandWidth;

            // Gain stage: amplify the filtered signal so thresholds are usable
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 50;

            // Analyser for optional frequency visualization
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 1024;
            this.analyser.smoothingTimeConstant = 0.3;

            // ScriptProcessor for sample-level detection after bandpass+gain
            this.scriptProcessor = this.audioContext.createScriptProcessor(256, 1, 1);

            // Envelope follower coefficients
            // Attack: fast (~0.5ms) to catch pulse onset
            // Release: moderate (~2ms) to let envelope drop between pulses
            this.attackCoeff = Math.exp(-1.0 / (sampleRate * 0.0005));
            this.releaseCoeff = Math.exp(-1.0 / (sampleRate * 0.002));

            // Minimum gap between pulses: ~0.5ms
            this.minPulseSamples = Math.round(sampleRate * 0.0005);

            this.scriptProcessor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                const output = e.outputBuffer.getChannelData(0);
                this.processFilteredAudio(input);
                // Silence the output
                for (let i = 0; i < output.length; i++) output[i] = 0;
            };

            // Wire up: Mic → Bandpass → Gain → ScriptProcessor → destination
            this.microphone.connect(this.bandpassFilter);
            this.bandpassFilter.connect(this.gainNode);
            this.gainNode.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);

            // Also connect raw mic to analyser for spectrum display
            this.microphone.connect(this.analyser);

            // Reset state
            this.isListening = true;
            this.startTime = Date.now();
            this.countsInWindow = [];
            this.envelope = 0;
            this.inPulse = false;
            this.samplesSinceLastPulse = 9999;

            this.updateUI();

            // UI update timer (10 Hz)
            this.uiUpdateInterval = setInterval(() => {
                this.updateDisplay();
            }, 100);

            // Visualization loop (separate from detection)
            this.visualizationLoop();

        } catch (error) {
            console.error('Error accessing microphone:', error);
            this.setStatus('Microphone access denied', 'error');
        }
    }

    stop() {
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor.onaudioprocess = null;
            this.scriptProcessor = null;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.bandpassFilter) {
            this.bandpassFilter.disconnect();
            this.bandpassFilter = null;
        }
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone.mediaStream.getTracks().forEach(track => track.stop());
            this.microphone = null;
        }
        if (this.uiUpdateInterval) {
            clearInterval(this.uiUpdateInterval);
            this.uiUpdateInterval = null;
        }
        this.isListening = false;
        this.updateUI();
    }

    reset() {
        this.counts = 0;
        this.countsInWindow = [];
        this.peakCps = 0;
        this.envelope = 0;
        this.inPulse = false;
        this.samplesSinceLastPulse = 9999;
        this.updateDisplay();
        this.setStatus('Counter reset', 'ready');
    }

    // === CORE DETECTION: runs at full sample rate (~48kHz) ===
    processFilteredAudio(input) {
        // Threshold: sensitivity maps to a range
        // After bandpass + 50x gain, signal is in a usable range
        // High sensitivity (1.0) = low threshold; Low sensitivity (0.0) = high threshold
        const threshold = 0.02 + (1.0 - this.sensitivity) * 0.18;
        const hysteresisLow = threshold * 0.35;

        // Scroll viz buffer: shift old data left, append new samples on right
        const vizLen = this.vizBuffer.length;
        const inputLen = input.length;
        if (inputLen >= vizLen) {
            this.vizBuffer.set(input.subarray(inputLen - vizLen));
        } else {
            this.vizBuffer.copyWithin(0, inputLen);
            this.vizBuffer.set(input, vizLen - inputLen);
        }
        // Shift envelope buffer left (filled during detection loop below)
        this.vizEnvelopeBuffer.copyWithin(0, inputLen);
        this.vizThreshold = threshold;

        for (let i = 0; i < inputLen; i++) {
            const sample = Math.abs(input[i]);

            // Envelope follower: fast attack, moderate release
            if (sample > this.envelope) {
                this.envelope = this.attackCoeff * this.envelope + (1 - this.attackCoeff) * sample;
            } else {
                this.envelope = this.releaseCoeff * this.envelope + (1 - this.releaseCoeff) * sample;
            }

            // Store envelope for visualization (scrolled position)
            const envIdx = vizLen - inputLen + i;
            if (envIdx >= 0 && envIdx < vizLen) {
                this.vizEnvelopeBuffer[envIdx] = this.envelope;
            }

            this.samplesSinceLastPulse++;

            // State machine: detect rising edge (entering pulse)
            if (!this.inPulse && this.envelope > threshold && this.samplesSinceLastPulse > this.minPulseSamples) {
                this.inPulse = true;
                this.counts++;
                this.countsInWindow.push(Date.now());
                this.samplesSinceLastPulse = 0;
            } else if (this.inPulse && this.envelope < hysteresisLow) {
                this.inPulse = false;
            }
        }
    }

    visualizationLoop() {
        if (!this.isListening) return;
        this.drawFilteredSignal();
        requestAnimationFrame(() => this.visualizationLoop());
    }

    updateDisplay() {
        const now = Date.now();
        const elapsedSeconds = (now - this.startTime) / 1000;

        // Clean old counts outside the 1-second window
        this.countsInWindow = this.countsInWindow.filter(t => now - t < 1000);

        const cps = this.countsInWindow.length;
        const cpm = elapsedSeconds > 0 ? Math.round((this.counts / elapsedSeconds) * 60) : 0;

        if (cps > this.peakCps) {
            this.peakCps = cps;
        }

        this.cpsDisplay.textContent = cps.toFixed(1);
        this.cpmDisplay.textContent = cpm;
        this.totalDisplay.textContent = this.counts;
        this.peakCpsDisplay.textContent = this.peakCps.toFixed(1);

        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = Math.floor(elapsedSeconds % 60);
        this.uptimeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        if (this.isListening) {
            this.setStatus(`${cps} CPS | ${cpm} CPM`, 'ready');
        }
    }

    setStatus(message, type) {
        this.statusText.textContent = message;
        this.statusMessage.textContent = '';

        if (type === 'error') {
            this.statusDot.classList.add('inactive');
        } else {
            this.statusDot.classList.remove('inactive');
        }
    }

    updateUI() {
        if (this.isListening) {
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.setStatus('Listening...', 'ready');
        } else {
            this.startBtn.disabled = false;
            this.stopBtn.disabled = true;
            this.setStatus('Ready', 'ready');
        }
    }

    // Draw the bandpass-filtered signal + envelope + threshold
    drawFilteredSignal() {
        const width = this.cssWidth;
        const height = this.cssHeight;

        // Clear
        this.canvasCtx.fillStyle = 'rgba(42, 44, 36, 0.85)';
        this.canvasCtx.fillRect(0, 0, width, height);

        const buf = this.vizBuffer;
        const envBuf = this.vizEnvelopeBuffer;
        const len = buf.length;
        const sliceWidth = width / len;

        // Find max for auto-scaling
        let maxVal = 0.01;
        for (let i = 0; i < len; i++) {
            maxVal = Math.max(maxVal, Math.abs(buf[i]), envBuf[i]);
        }
        maxVal = Math.max(maxVal, this.vizThreshold * 1.5);
        const scale = (height * 0.45) / maxVal;

        // Draw filtered waveform (centered)
        this.canvasCtx.strokeStyle = 'rgba(255, 163, 0, 0.5)';
        this.canvasCtx.lineWidth = 1;
        this.canvasCtx.beginPath();
        for (let i = 0; i < len; i++) {
            const x = i * sliceWidth;
            const y = height / 2 - buf[i] * scale;
            if (i === 0) this.canvasCtx.moveTo(x, y);
            else this.canvasCtx.lineTo(x, y);
        }
        this.canvasCtx.stroke();

        // Draw envelope (top half)
        this.canvasCtx.strokeStyle = '#FFA300';
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.beginPath();
        for (let i = 0; i < len; i++) {
            const x = i * sliceWidth;
            const y = height / 2 - envBuf[i] * scale;
            if (i === 0) this.canvasCtx.moveTo(x, y);
            else this.canvasCtx.lineTo(x, y);
        }
        this.canvasCtx.stroke();

        // Draw envelope bottom mirror
        this.canvasCtx.beginPath();
        for (let i = 0; i < len; i++) {
            const x = i * sliceWidth;
            const y = height / 2 + envBuf[i] * scale;
            if (i === 0) this.canvasCtx.moveTo(x, y);
            else this.canvasCtx.lineTo(x, y);
        }
        this.canvasCtx.stroke();

        // Draw threshold lines
        const threshY = height / 2 - this.vizThreshold * scale;
        const threshYBottom = height / 2 + this.vizThreshold * scale;
        this.canvasCtx.strokeStyle = '#F6EDDD';
        this.canvasCtx.lineWidth = 1;
        this.canvasCtx.setLineDash([4, 4]);
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(0, threshY);
        this.canvasCtx.lineTo(width, threshY);
        this.canvasCtx.moveTo(0, threshYBottom);
        this.canvasCtx.lineTo(width, threshYBottom);
        this.canvasCtx.stroke();
        this.canvasCtx.setLineDash([]);

        // Draw hysteresis lines
        const hystY = height / 2 - this.vizThreshold * 0.4 * scale;
        const hystYBottom = height / 2 + this.vizThreshold * 0.4 * scale;
        this.canvasCtx.strokeStyle = 'rgba(246, 237, 221, 0.3)';
        this.canvasCtx.lineWidth = 1;
        this.canvasCtx.setLineDash([2, 4]);
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(0, hystY);
        this.canvasCtx.lineTo(width, hystY);
        this.canvasCtx.moveTo(0, hystYBottom);
        this.canvasCtx.lineTo(width, hystYBottom);
        this.canvasCtx.stroke();
        this.canvasCtx.setLineDash([]);

        // Center line
        this.canvasCtx.strokeStyle = 'rgba(255, 163, 0, 0.2)';
        this.canvasCtx.lineWidth = 1;
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(0, height / 2);
        this.canvasCtx.lineTo(width, height / 2);
        this.canvasCtx.stroke();

        // Labels
        this.canvasCtx.fillStyle = '#b8b0a0';
        this.canvasCtx.font = '10px Orbitron, monospace';
        this.canvasCtx.textAlign = 'left';
        this.canvasCtx.fillText('FILTERED ' + (this.targetFrequency / 1000).toFixed(1) + ' kHz', 5, 13);
        this.canvasCtx.textAlign = 'right';
        this.canvasCtx.fillText(this.inPulse ? '● PULSE' : '○ IDLE', width - 5, 13);
        this.canvasCtx.textAlign = 'left';
    }

    drawCanvas() {
        const width = this.cssWidth;
        const height = this.cssHeight;

        this.canvasCtx.fillStyle = 'rgba(42, 44, 36, 0.8)';
        this.canvasCtx.fillRect(0, 0, width, height);

        this.canvasCtx.fillStyle = '#b8b0a0';
        this.canvasCtx.font = '12px Orbitron, monospace';
        this.canvasCtx.textAlign = 'center';
        this.canvasCtx.fillText('Start listening to see signal', width / 2, height / 2);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.geigerCounter = new GeigerCounter();
});
