// Main entry point: scene setup, game loop, state machine, input
import * as THREE from 'three';
import { World } from './world.js';
import { FlightPhysics } from './physics.js';
import { PlaneModel, computePhysicsConfig, PARTS } from './plane.js';
import { Economy } from './economy.js';
import { GameCamera } from './camera.js';
import { Effects } from './effects.js';
import { VarioAudio } from './audio.js';
import { UI } from './ui.js';
import { saveGame, loadGame, deleteSave, DEFAULT_STATE } from './save.js';

// ============================================================
// GAME CLASS
// ============================================================
class Game {
  constructor() {
    this.state = null;
    this.scene = null;
    this.renderer = null;
    this.camera = null;
    this.gameCamera = null;
    this.world = null;
    this.physics = null;
    this.planeModel = null;
    this.economy = null;
    this.effects = null;
    this.audio = null;
    this.ui = null;

    // Input state
    this.keys = {};
    this.gameState = 'loading'; // loading, landed, flying, crashed

    // Timing
    this.lastTime = 0;
    this.physicsAccum = 0;
    this.PHYSICS_DT = 1 / 60;

    // Sun/time
    this.timeOfDay = 0.3; // 0-1, 0.3 = morning
    this.sunLight = null;
    this.ambientLight = null;
  }

  async init() {
    // Load or create state
    const saved = loadGame();
    this.state = saved || { ...DEFAULT_STATE };

    this._setupRenderer();
    this._setupScene();
    this._setupInput();

    // UI
    this.ui = new UI(this);
    this.ui.setLoadingProgress(10);

    // World
    this.world = new World(this.scene, this.state.worldSeed);
    this.ui.setLoadingProgress(40);

    // Physics
    this.physics = new FlightPhysics();
    const physConfig = computePhysicsConfig(this.state.planeConfig);
    this.physics.setConfig(physConfig);
    this.ui.setLoadingProgress(50);

    // Plane model
    this.planeModel = new PlaneModel();
    this.planeModel.setConfig(this.state.planeConfig);
    this.scene.add(this.planeModel.group);
    this.ui.setLoadingProgress(60);

    // Economy
    this.economy = new Economy(this.world.airports, this.state.worldSeed);
    this.ui.setLoadingProgress(70);

    // Camera
    this.gameCamera = new GameCamera(this.camera);
    this.ui.setLoadingProgress(80);

    // Effects
    this.effects = new Effects(this.scene);
    this.ui.setLoadingProgress(90);

    // Audio
    this.audio = new VarioAudio();

    // Place plane at starting airport
    const startAirport = this.world.airports[this.state.currentAirport] || this.world.airports[0];
    this.physics.resetAt(startAirport);

    // Generate initial terrain around start
    this.world.update(startAirport.x, startAirport.z);

    // Generate missions
    this.economy.generateMissions(startAirport.id);

    this.ui.setLoadingProgress(100);

    // Start in landed state
    this.gameState = 'landed';

    // Small delay before hiding loading
    setTimeout(() => {
      this.ui.hideLoading();
      this.ui.showLandedMenu(startAirport);
      this.gameCamera.setLandedView(
        this.physics.position,
        startAirport.heading
      );
    }, 500);

    // Start game loop
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _setupRenderer() {
    const canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x8ab4d4, 0.00015);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      65, window.innerWidth / window.innerHeight, 1, 15000
    );

    // Sky background
    this.scene.background = new THREE.Color(0x87CEEB);

    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0x6688aa, 0.5);
    this.scene.add(this.ambientLight);

    // Sun (directional light)
    this.sunLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    this.sunLight.position.set(200, 500, 100);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 2000;
    this.sunLight.shadow.camera.left = -500;
    this.sunLight.shadow.camera.right = 500;
    this.sunLight.shadow.camera.top = 500;
    this.sunLight.shadow.camera.bottom = -500;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Hemisphere light for natural ambient
    const hemiLight = new THREE.HemisphereLight(0x88bbdd, 0x445522, 0.4);
    this.scene.add(hemiLight);
  }

  _setupInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      // Initialize audio on first input
      if (!this.audio.ctx) {
        this.audio.init();
      } else {
        this.audio.resume();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  // === GAME LOOP ===
  _loop(timestamp) {
    requestAnimationFrame((t) => this._loop(t));

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1); // cap at 100ms
    this.lastTime = timestamp;

    // Process input
    this._processInput();

    // Fixed timestep physics
    if (this.gameState === 'flying') {
      this.physicsAccum += dt;
      while (this.physicsAccum >= this.PHYSICS_DT && this.gameState === 'flying') {
        const result = this.physics.update(this.PHYSICS_DT, this.world);
        this._handlePhysicsResult(result);
        this.physicsAccum -= this.PHYSICS_DT;
      }

      // Economy update
      const econResult = this.economy.update(dt);
      if (econResult) this._handleEconResult(econResult);

      // Audio
      this.audio.update(dt, this.physics.verticalSpeed);

      // HUD
      this.ui.updateHUD(this.physics, this.world, this.economy);
      this.ui.updateMinimap(this.physics, this.world, this.economy);
    }

    // Update world chunks
    this.world.update(this.physics.position.x, this.physics.position.z);

    // Update plane model
    this.planeModel.syncWithPhysics(this.physics);

    // Camera
    if (this.gameState === 'flying') {
      this.gameCamera.update(dt, this.physics.position, this.physics.orientation, this.physics.speed);
    }

    // Effects
    if (this.gameState === 'flying') {
      this.effects.emitWindLines(this.physics.position, this.physics.orientation, this.physics.speed);

      // Spawn thermal dust near player
      const thermal = this.world.getThermalLift(
        this.physics.position.x, this.physics.position.y, this.physics.position.z
      );
      if (thermal.lift > 2 && Math.random() < 0.05) {
        this.effects.spawnThermalDust(
          this.physics.position.x + (Math.random() - 0.5) * 100,
          this.physics.position.y - 30,
          this.physics.position.z + (Math.random() - 0.5) * 100,
          thermal.lift
        );
      }

      // Turbulence camera shake
      if (thermal.turbulence > 0.2) {
        this.gameCamera.addShake(thermal.turbulence * 0.5);
      }
    }

    this.effects.update(dt, this.physics.position, this.world.windDirection);

    // Update sun position (slow day/night cycle)
    this.timeOfDay = (this.timeOfDay + dt * 0.002) % 1;
    this._updateSun();

    // Shadow follows player
    this.sunLight.target.position.copy(this.physics.position);
    this.sunLight.position.copy(this.physics.position).add(
      new THREE.Vector3(200, 500, 100)
    );

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  _processInput() {
    if (this.gameState !== 'flying') return;

    // Pitch: W/S or ArrowUp/ArrowDown
    this.physics.pitchInput = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) this.physics.pitchInput = -1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) this.physics.pitchInput = 1;

    // Roll: A/D or ArrowLeft/ArrowRight
    this.physics.rollInput = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.physics.rollInput = -1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) this.physics.rollInput = 1;

    // Yaw: Q/E
    this.physics.yawInput = 0;
    if (this.keys['KeyQ']) this.physics.yawInput = -1;
    if (this.keys['KeyE']) this.physics.yawInput = 1;

    // Speed brake: Space
    this.physics.brakeInput = this.keys['Space'] ? 1 : 0;
  }

  _handlePhysicsResult(result) {
    if (result === 'landed') {
      this._onLanded();
    } else if (result === 'crashed') {
      this._onCrashed();
    }
  }

  _handleEconResult(result) {
    if (result && result.type === 'mission_failed') {
      const mission = result.mission;
      this.economy.failMission(result.reason); // clear activeMission to prevent repeated penalty
      const penalty = mission.penalty;
      this.state.money = Math.max(0, this.state.money - penalty);
      this.ui.showNotification(
        `Mission failed: ${result.reason}! Penalty: $${penalty}`,
        'error'
      );
      this.audio.playNotification('error');
    }
  }

  _onLanded() {
    this.gameState = 'landed';

    // Find which airport we landed at
    const airport = this.world.getAirportAt(
      this.physics.position.x, this.physics.position.y, this.physics.position.z
    );

    if (airport) {
      this.state.currentAirport = airport.id;

      // Unlock airport
      if (!this.state.unlockedAirports.includes(airport.id)) {
        this.state.unlockedAirports.push(airport.id);
        this.ui.showNotification(`New airport discovered: ${airport.name}!`, 'success');
        this.audio.playNotification('success');
      }

      // Check mission completion
      const mResult = this.economy.completeMission(airport.id);
      if (mResult) {
        if (this.physics.cargoSpoiled && mResult.mission && mResult.mission.heatSensitive) {
          // Cargo spoiled - apply penalty instead of reward
          const penalty = mResult.mission.penalty || Math.round(mResult.reward * 0.5);
          this.state.money = Math.max(0, this.state.money - penalty);
          this.ui.showNotification(`Cargo spoiled! Penalty: $${penalty}`, 'error');
          this.audio.playNotification('error');
        } else {
          this.state.money += mResult.reward;
          this.ui.showNotification(`Mission complete! +$${mResult.reward}`, 'success');
          this.audio.playNotification('success');
        }
      }

      // Generate new missions
      this.economy.generateMissions(airport.id);

      // Auto-save
      this.state.totalFlights++;
      this.state.position = {
        x: this.physics.position.x,
        y: this.physics.position.y,
        z: this.physics.position.z
      };
      saveGame(this.state);

      // Show menu
      this.ui.showLandedMenu(airport);
      this.gameCamera.setLandedView(this.physics.position, airport.heading);

    } else {
      // Landed outside airport (shouldn't happen due to physics check, but just in case)
      this.ui.showNotification('Landed outside airport zone', 'error');
      this.gameState = 'flying';
      this.physics.landed = false;
    }
  }

  _onCrashed() {
    this.gameState = 'crashed';

    // Fail active mission
    if (this.economy.activeMission) {
      const fail = this.economy.failMission('crashed');
      if (fail) {
        this.state.money = Math.max(0, this.state.money - fail.penalty);
      }
    }

    // Crash penalty: 10% of cash
    const penalty = Math.round(this.state.money * 0.1);
    this.state.money = Math.max(0, this.state.money - penalty);
    this.state.cargo = []; // lose cargo

    this.ui.showNotification(
      `CRASHED! Towing fee: $${penalty}. Cargo lost.`,
      'error'
    );
    this.audio.playNotification('error');
    this.gameCamera.addShake(3);

    // Respawn at last airport after delay
    setTimeout(() => {
      const airport = this.world.airports[this.state.currentAirport] || this.world.airports[0];
      this.physics.resetAt(airport);
      this.gameState = 'landed';
      saveGame(this.state);
      this.ui.showLandedMenu(airport);
      this.gameCamera.setLandedView(this.physics.position, airport.heading);
    }, 2000);
  }

  _updateSun() {
    const angle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    const sunY = Math.sin(angle);
    const sunX = Math.cos(angle);

    // Sky color changes with time
    const dayColor = new THREE.Color(0x87CEEB);
    const dawnColor = new THREE.Color(0xff8844);
    const nightColor = new THREE.Color(0x0a1628);

    if (sunY > 0.1) {
      this.scene.background.copy(dayColor);
      this.sunLight.intensity = 1.2;
      this.ambientLight.intensity = 0.5;
    } else if (sunY > -0.1) {
      const t = (sunY + 0.1) / 0.2;
      this.scene.background.lerpColors(dawnColor, dayColor, t);
      this.sunLight.intensity = 0.4 + t * 0.8;
      this.ambientLight.intensity = 0.3 + t * 0.2;
    } else {
      this.scene.background.copy(nightColor);
      this.sunLight.intensity = 0.1;
      this.ambientLight.intensity = 0.15;
    }

    this.scene.fog.color.copy(this.scene.background);
  }

  // === PUBLIC ACTIONS (called by UI) ===

  launch(type) {
    if (this.gameState !== 'landed') return;

    if (type === 'aerotow') {
      if (this.state.money < 100) return;
      this.state.money -= 100;
    }

    // Apply physics config with cargo
    const physConfig = computePhysicsConfig(this.state.planeConfig);
    const cargoWeight = this.state.cargo.reduce((sum, c) => sum + c.weight, 0);
    physConfig.cargoMass = cargoWeight;
    this.physics.setConfig(physConfig);

    this.physics.launch(type);
    this.gameState = 'flying';
    this.ui.hideLandedMenu();

    // Init audio on launch
    if (!this.audio.ctx) this.audio.init();
    else this.audio.resume();
  }

  buyCargo(commodityId) {
    const ap = this.world.airports.find(a => a.id === this.state.currentAirport);
    if (!ap) return;

    const physConfig = computePhysicsConfig(this.state.planeConfig);
    const currentVolume = this.state.cargo.reduce((sum, c) => sum + c.volume, 0);

    // Check cargo capacity (volume-based)
    if (currentVolume >= physConfig.cargoCapacity) {
      this.ui.showNotification('Cargo hold full!', 'error');
      return;
    }

    const result = this.economy.buyCommodity(ap.id, commodityId, this.state.money);
    if (result) {
      this.state.money -= result.cost;
      this.state.cargo.push({
        id: commodityId,
        name: result.name,
        weight: result.weight,
        volume: result.volume
      });
      this.ui.showNotification(`Bought ${result.name} for $${result.cost}`, 'success');
      this.ui.showLandedMenu(ap);
    } else {
      this.ui.showNotification('Cannot buy - check funds and stock', 'error');
    }
  }

  sellCargo(commodityId) {
    const ap = this.world.airports.find(a => a.id === this.state.currentAirport);
    if (!ap) return;

    const idx = this.state.cargo.findIndex(c => c.id === commodityId);
    if (idx === -1) {
      this.ui.showNotification('You don\'t have that cargo', 'error');
      return;
    }

    const result = this.economy.sellCommodity(ap.id, commodityId);
    if (result) {
      this.state.money += result.revenue;
      this.state.cargo.splice(idx, 1);
      this.ui.showNotification(`Sold for $${result.revenue}`, 'success');
      this.ui.showLandedMenu(ap);
    }
  }

  acceptMission(missionId) {
    if (this.economy.activeMission) {
      this.ui.showNotification('Complete or fail current mission first', 'error');
      return;
    }

    const ok = this.economy.acceptMission(missionId);
    if (ok) {
      this.ui.showNotification('Mission accepted!', 'success');
      this.audio.playNotification('success');
      const ap = this.world.airports.find(a => a.id === this.state.currentAirport);
      this.ui.showLandedMenu(ap);
    } else {
      this.ui.showNotification('Cannot accept mission', 'error');
    }
  }

  selectPart(category, key) {
    const part = PARTS[category]?.[key];
    if (!part) return;

    // Check cost
    const currentPart = PARTS[category]?.[this.state.planeConfig[category]];
    const costDiff = part.cost - (currentPart?.cost || 0);

    if (costDiff > 0 && this.state.money < costDiff) {
      this.ui.showNotification(`Need $${costDiff} more for this part`, 'error');
      return;
    }

    if (costDiff > 0) {
      this.state.money -= costDiff;
    }

    this.state.planeConfig[category] = key;
    this.planeModel.setConfig(this.state.planeConfig);

    const physConfig = computePhysicsConfig(this.state.planeConfig);
    this.physics.setConfig(physConfig);

    saveGame(this.state);

    const ap = this.world.airports.find(a => a.id === this.state.currentAirport);
    this.ui.showLandedMenu(ap);
    this.ui.showNotification(`Equipped: ${part.name}`, 'success');
  }

  restart() {
    deleteSave();
    this.state = {
      ...DEFAULT_STATE,
      worldSeed: Math.floor(Math.random() * 999999)
    };

    // Dispose old world and effects
    this.world.dispose();
    this.effects.dispose();

    // Recreate world
    this.world = new World(this.scene, this.state.worldSeed);
    this.economy = new Economy(this.world.airports, this.state.worldSeed);
    this.effects = new Effects(this.scene);

    // Reset plane
    this.planeModel.setConfig(this.state.planeConfig);
    const physConfig = computePhysicsConfig(this.state.planeConfig);
    this.physics.setConfig(physConfig);

    const airport = this.world.airports[0];
    this.physics.resetAt(airport);
    this.state.currentAirport = 0;
    this.state.unlockedAirports = [0];
    this.state.cargo = [];

    this.economy.generateMissions(0);
    saveGame(this.state);

    this.gameState = 'landed';
    this.ui.showLandedMenu(airport);
    this.gameCamera.setLandedView(this.physics.position, airport.heading);
    this.ui.showNotification('New world generated!', 'success');
  }
}

// ============================================================
// START
// ============================================================
const game = new Game();
game.init().catch(err => {
  console.error('Game init failed:', err);
  document.getElementById('loading').innerHTML = `
    <h1 style="color:#ff4757">Error</h1>
    <p>${err.message}</p>
  `;
});
