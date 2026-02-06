// UI: HUD instruments, landed menu, minimap, notifications
import { PARTS, computePhysicsConfig } from './plane.js';
import { BIOME } from './noise.js';

const BIOME_NAMES = {
  [BIOME.OCEAN]: 'Ocean',
  [BIOME.PLAINS]: 'Plains',
  [BIOME.MOUNTAINS]: 'Mountains',
  [BIOME.ISLAND]: 'Island',
  [BIOME.AIRPORT]: 'Airport'
};

export class UI {
  constructor(game) {
    this.game = game;

    // Cache DOM elements
    this.hud = document.getElementById('hud');
    this.landedMenu = document.getElementById('landed-menu');
    this.loading = document.getElementById('loading');
    this.notification = document.getElementById('notification');

    // HUD elements
    this.altValue = document.getElementById('alt-value');
    this.varioValue = document.getElementById('vario-value');
    this.varioBar = document.getElementById('vario-bar');
    this.speedValue = document.getElementById('speed-value');
    this.tempValue = document.getElementById('temp-value');
    this.tempWarning = document.getElementById('temp-warning');
    this.stallWarning = document.getElementById('stall-warning');
    this.pullUpWarning = document.getElementById('pull-up-warning');
    this.missionInfo = document.getElementById('mission-info');
    this.biomeInfo = document.getElementById('biome-info');
    this.minimap = document.getElementById('minimap');
    this.minimapCtx = this.minimap.getContext('2d');

    // Menu elements
    this.airportName = document.getElementById('airport-name');
    this.playerMoney = document.getElementById('player-money');
    this.cargoList = document.getElementById('cargo-list');
    this.planeWeight = document.getElementById('plane-weight');
    this.marketGrid = document.getElementById('market-grid');
    this.missionList = document.getElementById('mission-list');
    this.builderStats = document.getElementById('builder-stats');

    this._notifTimeout = null;
    this._setupTabs();
    this._setupButtons();
  }

  _setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

        // Refresh content when switching tabs
        this._refreshTab(tab.dataset.tab);
      });
    });
  }

  _setupButtons() {
    document.getElementById('btn-cable-launch').addEventListener('click', () => {
      this.game.launch('cable');
    });

    document.getElementById('btn-aerotow').addEventListener('click', () => {
      if (this.game.state.money < 100) {
        this.showNotification('Not enough credits for aerotow!', 'error');
        return;
      }
      this.game.launch('aerotow');
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
      if (confirm('Are you sure? All progress will be lost.')) {
        this.game.restart();
      }
    });
  }

  _refreshTab(tab) {
    switch (tab) {
      case 'market': this._renderMarket(); break;
      case 'missions': this._renderMissions(); break;
      case 'builder': this._renderBuilder(); break;
      case 'launch': this._renderLaunch(); break;
    }
  }

  // === MENU STATE ===
  showLandedMenu(airport) {
    this.hud.classList.add('hidden');
    this.landedMenu.classList.remove('hidden');
    this.airportName.textContent = airport ? airport.name : 'Unknown';
    this.playerMoney.textContent = `$${this.game.state.money}`;
    this._renderLaunch();
    this._renderMarket();
    this._renderMissions();
    this._renderBuilder();
  }

  hideLandedMenu() {
    this.landedMenu.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }

  hideLoading() {
    this.loading.classList.add('hidden');
  }

  setLoadingProgress(pct) {
    const fill = this.loading.querySelector('.loading-fill');
    if (fill) fill.style.width = `${pct}%`;
  }

  // === HUD UPDATE ===
  updateHUD(physics, world, economy) {
    // Altimeter
    this.altValue.textContent = Math.round(physics.altitude);

    // Variometer
    const vs = physics.verticalSpeed;
    this.varioValue.textContent = (vs >= 0 ? '+' : '') + vs.toFixed(1);

    // Vario bar visualization
    const barPct = Math.min(100, Math.abs(vs) * 10);
    if (vs >= 0) {
      this.varioBar.style.bottom = '50%';
      this.varioBar.style.top = 'auto';
      this.varioBar.style.height = `${barPct / 2}%`;
      this.varioBar.style.background = '#4ecdc4';
    } else {
      this.varioBar.style.top = '50%';
      this.varioBar.style.bottom = 'auto';
      this.varioBar.style.height = `${barPct / 2}%`;
      this.varioBar.style.background = '#ff6b35';
    }

    // Speed
    this.speedValue.textContent = Math.round(physics.speedKmh);

    // Temperature
    this.tempValue.textContent = Math.round(physics.currentTemp);
    if (physics.currentTemp > 30) {
      this.tempWarning.classList.remove('hidden');
    } else {
      this.tempWarning.classList.add('hidden');
    }

    // Stall warning
    if (physics.stalling) {
      this.stallWarning.classList.remove('hidden');
    } else {
      this.stallWarning.classList.add('hidden');
    }

    // Pull up warning
    const groundH = world.getHeightAt(physics.position.x, physics.position.z);
    if (physics.altitude - groundH < 50 && physics.verticalSpeed < -2) {
      this.pullUpWarning.classList.remove('hidden');
    } else {
      this.pullUpWarning.classList.add('hidden');
    }

    // Mission info
    if (economy.activeMission) {
      const m = economy.activeMission;
      const dx = m.destX - physics.position.x;
      const dz = m.destZ - physics.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      let info = `✈ ${m.destName} | ${(dist / 1000).toFixed(1)} km`;
      if (m.timeRemaining !== null && m.timeRemaining !== undefined) {
        info += ` | ⏱ ${Math.max(0, Math.round(m.timeRemaining))}s`;
      }
      if (physics.cargoSpoiled) {
        info += ' | ⚠ CARGO SPOILED';
      }
      this.missionInfo.textContent = info;
      this.missionInfo.style.display = 'block';
    } else {
      this.missionInfo.style.display = 'none';
    }

    // Biome
    const biome = world.getBiomeAt(physics.position.x, physics.position.z);
    this.biomeInfo.textContent = BIOME_NAMES[biome] || 'Unknown';
  }

  // === MINIMAP ===
  updateMinimap(physics, world, economy) {
    const ctx = this.minimapCtx;
    const w = this.minimap.width;
    const h = this.minimap.height;
    const scale = 4; // meters per pixel
    const radius = w / 2 * scale;

    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, w, h);

    const px = physics.position.x;
    const pz = physics.position.z;

    // Terrain heat map
    const step = 8;
    for (let sy = 0; sy < h; sy += step) {
      for (let sx = 0; sx < w; sx += step) {
        const wx = px + (sx - w / 2) * scale;
        const wz = pz + (sy - h / 2) * scale;
        const biome = world.getBiomeAt(wx, wz);
        const thermal = world.getThermalLift(wx, 500, wz);

        let color;
        if (biome === BIOME.OCEAN) {
          color = '#0e3a5a';
        } else if (thermal.lift > 1) {
          const intensity = Math.min(255, Math.round(thermal.lift * 40));
          color = `rgb(${intensity}, ${Math.round(intensity * 0.3)}, 0)`;
        } else if (thermal.lift < -0.5) {
          const intensity = Math.min(255, Math.round(Math.abs(thermal.lift) * 80));
          color = `rgb(0, ${Math.round(intensity * 0.3)}, ${intensity})`;
        } else {
          switch (biome) {
            case BIOME.PLAINS: color = '#2a4a20'; break;
            case BIOME.MOUNTAINS: color = '#4a4a3a'; break;
            case BIOME.ISLAND: color = '#5a4a20'; break;
            default: color = '#1a2a1a';
          }
        }

        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, step, step);
      }
    }

    // Airport markers
    for (const ap of world.airports) {
      const dx = ap.x - px;
      const dz = ap.z - pz;
      const sx = w / 2 + dx / scale;
      const sz = h / 2 + dz / scale;

      if (sx >= -10 && sx <= w + 10 && sz >= -10 && sz <= h + 10) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(sx) - 2, Math.round(sz) - 2, 4, 4);
      } else {
        // Off-screen: draw on edge as waypoint
        const angle = Math.atan2(dz, dx);
        const edgeX = w / 2 + Math.cos(angle) * (w / 2 - 5);
        const edgeZ = h / 2 + Math.sin(angle) * (h / 2 - 5);
        ctx.fillStyle = '#4ecdc4';
        ctx.beginPath();
        ctx.arc(edgeX, edgeZ, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Mission destination marker
    if (economy.activeMission) {
      const m = economy.activeMission;
      const dx = m.destX - px;
      const dz = m.destZ - pz;
      const sx = w / 2 + dx / scale;
      const sz = h / 2 + dz / scale;

      if (sx >= 0 && sx <= w && sz >= 0 && sz <= h) {
        ctx.fillStyle = '#ffe66d';
        ctx.beginPath();
        ctx.arc(sx, sz, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const angle = Math.atan2(dz, dx);
        const edgeX = w / 2 + Math.cos(angle) * (w / 2 - 5);
        const edgeZ = h / 2 + Math.sin(angle) * (h / 2 - 5);
        ctx.strokeStyle = '#ffe66d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(edgeX + Math.cos(angle) * 5, edgeZ + Math.sin(angle) * 5);
        ctx.lineTo(edgeX - Math.cos(angle - 0.5) * 5, edgeZ - Math.sin(angle - 0.5) * 5);
        ctx.lineTo(edgeX - Math.cos(angle + 0.5) * 5, edgeZ - Math.sin(angle + 0.5) * 5);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Player marker (center)
    const heading = Math.atan2(physics.forward.x, physics.forward.z);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-heading);
    ctx.fillStyle = '#4ecdc4';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(-3, 4);
    ctx.lineTo(3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Border
    ctx.strokeStyle = 'rgba(78,205,196,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);
  }

  // === MARKET ===
  _renderMarket() {
    const ap = this._getCurrentAirport();
    if (!ap) { this.marketGrid.innerHTML = '<p>No market data</p>'; return; }

    const market = this.game.economy.getMarket(ap.id);
    let html = `<div class="market-row header">
      <span>Commodity</span><span>Buy $</span><span>Sell $</span><span>Stock</span><span></span>
    </div>`;

    for (const [id, item] of Object.entries(market)) {
      const hasCargo = this.game.state.cargo.some(c => c.id === id);
      html += `<div class="market-row">
        <span class="market-commodity">${item.commodity.name}</span>
        <span class="market-buy">$${item.buyPrice}</span>
        <span class="market-sell">$${item.sellPrice}</span>
        <span>${item.stock}</span>
        <span>
          <button class="market-btn" onclick="window._gameBuy('${id}')"
            ${item.stock <= 0 || this.game.state.money < item.buyPrice ? 'disabled' : ''}>Buy</button>
          <button class="market-btn" onclick="window._gameSell('${id}')"
            ${!hasCargo ? 'disabled' : ''}>Sell</button>
        </span>
      </div>`;
    }

    this.marketGrid.innerHTML = html;

    // Global handlers
    window._gameBuy = (id) => this.game.buyCargo(id);
    window._gameSell = (id) => this.game.sellCargo(id);
  }

  // === MISSIONS ===
  _renderMissions() {
    const ap = this._getCurrentAirport();
    if (!ap) { this.missionList.innerHTML = '<p>No missions available</p>'; return; }

    const missions = this.game.economy.getAvailableMissions(ap.id);
    const active = this.game.economy.activeMission;

    let html = '';

    if (active) {
      html += `<div class="mission-card accepted">
        <span class="mission-type ${active.type}">${active.type.replace('-', ' ')}</span>
        <div class="mission-dest">→ ${active.destName} (ACTIVE)</div>
        <div class="mission-details">${active.cargo} x${active.quantity} | ${active.weight}kg</div>
        <div class="mission-reward">Reward: $${active.reward}</div>
        ${active.timeLimit ? `<div class="mission-timer">Time: ${Math.round(active.timeRemaining || active.timeLimit)}s</div>` : ''}
      </div>`;
    }

    if (missions.length === 0 && !active) {
      html = '<p style="color:#6a8caa;text-align:center;">No missions available. Check back later or visit another airport.</p>';
    }

    for (const m of missions) {
      const timeLeft = Math.round((m.expiresAt - Date.now()) / 1000);
      html += `<div class="mission-card" onclick="window._gameAcceptMission('${m.id}')">
        <span class="mission-type ${m.type}">${m.type.replace('-', ' ')}</span>
        <div class="mission-dest">→ ${m.destName}</div>
        <div class="mission-details">${m.cargo} x${m.quantity} | ${m.weight}kg
        ${m.heatSensitive ? '| 🌡 Heat Sensitive' : ''}
        ${m.timeLimit ? `| ⏱ ${m.timeLimit}s limit` : ''}</div>
        <div class="mission-reward">Reward: $${m.reward} | Penalty: $${m.penalty}</div>
        <div class="mission-timer">Expires in ${timeLeft}s</div>
      </div>`;
    }

    this.missionList.innerHTML = html;
    window._gameAcceptMission = (id) => this.game.acceptMission(id);
  }

  // === BUILDER ===
  _renderBuilder() {
    const cfg = this.game.state.planeConfig;

    for (const [category, parts] of Object.entries(PARTS)) {
      const idMap = { wingtips: 'wingtip', wings: 'wing' };
      const container = document.getElementById(`${idMap[category] || category}-options`);
      if (!container) continue;

      let html = '';
      for (const [key, part] of Object.entries(parts)) {
        const selected = cfg[category] === key;
        html += `<button class="part-btn ${selected ? 'selected' : ''}"
          onclick="window._gameSelectPart('${category}', '${key}')">
          <div class="part-name">${part.name}</div>
          <div class="part-stats">${part.desc}</div>
          ${part.cost > 0 ? `<div class="part-cost">$${part.cost}</div>` : '<div class="part-cost">Free</div>'}
        </button>`;
      }
      container.innerHTML = html;
    }

    // Stats summary
    const physCfg = computePhysicsConfig(cfg);
    this.builderStats.innerHTML = `
      <strong>Plane Stats</strong><br>
      Mass: ${physCfg.mass}kg | Wing Area: ${physCfg.wingArea}m² | AR: ${physCfg.aspectRatio}<br>
      Roll Rate: ${physCfg.rollRate.toFixed(1)} rad/s | Stall: ${Math.round(physCfg.stallSpeed * 3.6)} km/h<br>
      Max Speed: ${Math.round(physCfg.maxSpeed * 3.6)} km/h | Cargo: ${physCfg.cargoCapacity}L<br>
      Drag: ${physCfg.cd0.toFixed(4)} | Efficiency: ${physCfg.e.toFixed(2)}
    `;

    window._gameSelectPart = (cat, key) => this.game.selectPart(cat, key);
  }

  // === LAUNCH TAB ===
  _renderLaunch() {
    // Update cargo display
    const cargo = this.game.state.cargo;
    if (cargo.length === 0) {
      this.cargoList.textContent = 'Empty';
    } else {
      this.cargoList.innerHTML = cargo.map(c =>
        `${c.name} (${c.weight}kg)`
      ).join('<br>');
    }

    const physCfg = computePhysicsConfig(this.game.state.planeConfig);
    const cargoWeight = cargo.reduce((sum, c) => sum + c.weight, 0);
    this.planeWeight.textContent = `Total Weight: ${physCfg.mass + cargoWeight} kg`;

    // Update money display
    this.playerMoney.textContent = `$${this.game.state.money}`;

    // Disable aerotow if too poor
    const aerotowBtn = document.getElementById('btn-aerotow');
    if (this.game.state.money < 100) {
      aerotowBtn.style.opacity = '0.5';
    } else {
      aerotowBtn.style.opacity = '1';
    }
  }

  _getCurrentAirport() {
    return this.game.world.airports.find(
      a => a.id === this.game.state.currentAirport
    );
  }

  // === NOTIFICATIONS ===
  showNotification(message, type = 'info') {
    this.notification.textContent = message;
    this.notification.className = type;
    this.notification.classList.remove('hidden');

    clearTimeout(this._notifTimeout);
    this._notifTimeout = setTimeout(() => {
      this.notification.classList.add('hidden');
    }, 3000);
  }

  dispose() {
    clearTimeout(this._notifTimeout);
  }
}
