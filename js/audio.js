// Variometer audio: beeps with lift, low tone with sink
// Uses Web Audio API

export class VarioAudio {
  constructor() {
    this.ctx = null;
    this.oscillator = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.enabled = true;
    this.currentMode = 'silent'; // 'beep', 'sink', 'silent'
    this.beepTimer = 0;
    this.beepInterval = 0.5;
    this.beepOn = false;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.ctx.destination);
      this.gainNode.gain.value = 0;

      this.oscillator = this.ctx.createOscillator();
      this.oscillator.type = 'sine';
      this.oscillator.frequency.value = 400;
      this.oscillator.connect(this.gainNode);
      this.oscillator.start();
      this.isPlaying = true;
    } catch (e) {
      console.warn('Audio init failed:', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  update(dt, verticalSpeed) {
    if (!this.ctx || !this.enabled) {
      if (this.gainNode) this.gainNode.gain.value = 0;
      return;
    }

    const vs = verticalSpeed; // m/s

    if (vs > 0.5) {
      // Lift - beeping, pitch increases with lift
      this.currentMode = 'beep';

      // Frequency: 400Hz base + up to 800Hz more
      const freq = 400 + Math.min(800, vs * 150);
      this.oscillator.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);

      // Beep rate increases with lift
      this.beepInterval = Math.max(0.08, 0.5 - vs * 0.05);
      this.beepTimer += dt;

      if (this.beepTimer >= this.beepInterval) {
        this.beepTimer = 0;
        this.beepOn = !this.beepOn;
      }

      const targetGain = this.beepOn ? 0.15 : 0;
      this.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);

    } else if (vs < -1.0) {
      // Sink - continuous low tone
      this.currentMode = 'sink';
      const freq = 250 - Math.min(150, Math.abs(vs) * 20);
      this.oscillator.frequency.setTargetAtTime(Math.max(100, freq), this.ctx.currentTime, 0.05);
      this.gainNode.gain.setTargetAtTime(0.08, this.ctx.currentTime, 0.1);
      this.beepOn = true;
    } else {
      // Quiet zone
      this.currentMode = 'silent';
      this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      this.beepOn = false;
    }
  }

  // Play a one-shot notification sound
  playNotification(type = 'info') {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    if (type === 'success') {
      osc.frequency.value = 600;
      gain.gain.value = 0.1;
      osc.start();
      osc.frequency.setTargetAtTime(900, this.ctx.currentTime + 0.1, 0.05);
    } else if (type === 'error') {
      osc.frequency.value = 300;
      gain.gain.value = 0.12;
      osc.start();
      osc.frequency.setTargetAtTime(150, this.ctx.currentTime + 0.1, 0.05);
    } else {
      osc.frequency.value = 500;
      gain.gain.value = 0.08;
      osc.start();
    }

    gain.gain.setTargetAtTime(0, this.ctx.currentTime + 0.2, 0.05);
    osc.stop(this.ctx.currentTime + 0.4);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled && this.gainNode) {
      this.gainNode.gain.value = 0;
    }
  }

  dispose() {
    if (this.oscillator) this.oscillator.stop();
    if (this.ctx) this.ctx.close();
  }
}
