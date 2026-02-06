// Economy: trading, missions, dynamic pricing
import { SeededRandom } from './noise.js';

// Commodity definitions
export const COMMODITIES = [
  { id: 'fish', name: 'Fresh Fish', basePrice: 50, weight: 2, volume: 3 },
  { id: 'tools', name: 'Mining Tools', basePrice: 120, weight: 5, volume: 4 },
  { id: 'medicine', name: 'Medical Supplies', basePrice: 200, weight: 1, volume: 2, heatSensitive: true },
  { id: 'electronics', name: 'Electronics', basePrice: 180, weight: 1.5, volume: 2 },
  { id: 'food', name: 'Preserved Food', basePrice: 40, weight: 3, volume: 3 },
  { id: 'textiles', name: 'Textiles', basePrice: 60, weight: 1, volume: 5 },
  { id: 'fuel', name: 'Aviation Fuel', basePrice: 90, weight: 4, volume: 3 },
  { id: 'mail', name: 'Priority Mail', basePrice: 30, weight: 0.5, volume: 1 },
  { id: 'gems', name: 'Gemstones', basePrice: 500, weight: 0.3, volume: 0.5 },
  { id: 'parts', name: 'Spare Parts', basePrice: 150, weight: 3, volume: 4 }
];

// Biome demand multipliers
const BIOME_DEMAND = {
  0: { fish: 0.5, tools: 1.0 },     // Ocean (not really used)
  1: { fish: 1.5, tools: 0.8, food: 0.7, electronics: 1.3 },  // Plains
  2: { fish: 2.0, tools: 0.5, gems: 0.6, fuel: 1.5 },          // Mountains
  3: { fish: 0.6, tools: 2.0, medicine: 1.5, electronics: 1.8 } // Islands
};

export class Economy {
  constructor(airports, seed) {
    this.airports = airports;
    this.seed = seed;
    this.rng = new SeededRandom(seed + 1000);
    this.missions = [];
    this.activeMission = null;
    this.missionTimer = 0;
    this.missionGenTimer = 0;

    // Initialize airport markets
    this._initMarkets();
  }

  _initMarkets() {
    for (const ap of this.airports) {
      const rng = new SeededRandom(this.seed + ap.id * 77);
      ap.market = {};
      ap.supply = [];
      ap.demand = [];

      // Each airport has 4-6 commodities available
      const available = [...COMMODITIES].sort(() => rng.next() - 0.5).slice(0, 4 + rng.nextInt(0, 3));

      for (const comm of available) {
        const biomeMod = BIOME_DEMAND[ap.biome]?.[comm.id] || 1.0;
        const distFromOrigin = Math.sqrt(ap.x * ap.x + ap.z * ap.z);
        const distMod = 1 + (distFromOrigin / 8000) * 0.5; // farther = pricier

        const buyPrice = Math.round(comm.basePrice * biomeMod * distMod * (0.8 + rng.next() * 0.4));
        const sellPrice = Math.round(buyPrice * (0.6 + rng.next() * 0.3));
        const stock = rng.nextInt(2, 15);

        ap.market[comm.id] = {
          commodity: comm,
          buyPrice,
          sellPrice,
          stock,
          maxStock: stock + 5
        };

        if (rng.next() > 0.5) ap.supply.push(comm.id);
        else ap.demand.push(comm.id);
      }
    }
  }

  // Generate missions for a specific airport
  generateMissions(airportId) {
    const ap = this.airports.find(a => a.id === airportId);
    if (!ap) return;

    const rng = new SeededRandom(Date.now());

    // Clear expired missions
    this.missions = this.missions.filter(m => m.expiresAt > Date.now());

    // Generate 3-5 new missions
    const count = 3 + rng.nextInt(0, 3);
    for (let i = 0; i < count; i++) {
      // Pick destination (different airport)
      const destinations = this.airports.filter(a => a.id !== airportId);
      if (destinations.length === 0) continue;
      const dest = destinations[rng.nextInt(0, destinations.length)];

      const distance = Math.sqrt((ap.x - dest.x) ** 2 + (ap.z - dest.z) ** 2);
      const types = ['standard', 'urgent', 'cold-chain'];
      const typeWeights = [0.5, 0.3, 0.2];
      let r = rng.next();
      let type = 'standard';
      if (r < typeWeights[2]) type = 'cold-chain';
      else if (r < typeWeights[2] + typeWeights[1]) type = 'urgent';

      // Pick cargo
      const commodityList = Object.keys(ap.market);
      const cargoId = commodityList.length > 0
        ? commodityList[rng.nextInt(0, commodityList.length)]
        : COMMODITIES[0].id;
      const cargo = COMMODITIES.find(c => c.id === cargoId) || COMMODITIES[0];

      const quantity = 1 + rng.nextInt(0, 5);
      const baseReward = Math.round(distance * 0.1 + cargo.basePrice * quantity * 0.5);

      let reward, timeLimit, penalty;
      switch (type) {
        case 'urgent':
          reward = Math.round(baseReward * 1.8);
          timeLimit = Math.round(60 + distance / 20); // seconds
          penalty = Math.round(reward * 1.5);
          break;
        case 'cold-chain':
          reward = Math.round(baseReward * 2.0);
          timeLimit = null; // no time limit, but thermal limit
          penalty = Math.round(reward * 2.0);
          break;
        default:
          reward = Math.round(baseReward * 1.0);
          timeLimit = null;
          penalty = Math.round(reward * 0.5);
      }

      this.missions.push({
        id: `m_${Date.now()}_${i}`,
        type,
        fromAirport: airportId,
        toAirport: dest.id,
        destName: dest.name,
        destX: dest.x,
        destZ: dest.z,
        cargo: cargo.name,
        cargoId: cargo.id,
        quantity,
        weight: cargo.weight * quantity,
        volume: cargo.volume * quantity,
        reward,
        penalty,
        timeLimit,
        timeRemaining: timeLimit,
        expiresAt: Date.now() + 120000, // 2 minutes to accept
        accepted: false,
        heatSensitive: type === 'cold-chain' || cargo.heatSensitive
      });
    }
  }

  acceptMission(missionId) {
    const mission = this.missions.find(m => m.id === missionId);
    if (!mission || mission.accepted) return false;
    if (this.activeMission) return false; // one at a time

    mission.accepted = true;
    this.activeMission = mission;
    return true;
  }

  // Update mission timers
  update(dt) {
    if (this.activeMission) {
      if (this.activeMission.timeLimit) {
        this.activeMission.timeRemaining -= dt;
        if (this.activeMission.timeRemaining <= 0) {
          return { type: 'mission_failed', mission: this.activeMission, reason: 'timeout' };
        }
      }
    }

    // Remove expired unaccepted missions
    const now = Date.now();
    this.missions = this.missions.filter(m => m.accepted || m.expiresAt > now);

    return null;
  }

  completeMission(airportId) {
    if (!this.activeMission) return null;
    if (this.activeMission.toAirport !== airportId) return null;

    const reward = this.activeMission.reward;
    const mission = this.activeMission;
    this.activeMission = null;
    this.missions = this.missions.filter(m => m.id !== mission.id);

    return { type: 'mission_complete', reward, mission };
  }

  failMission(reason) {
    if (!this.activeMission) return null;
    const penalty = this.activeMission.penalty;
    const mission = this.activeMission;
    this.activeMission = null;
    this.missions = this.missions.filter(m => m.id !== mission.id);
    return { type: 'mission_failed', penalty, mission, reason };
  }

  // Buy commodity at airport
  buyCommodity(airportId, commodityId, money) {
    const ap = this.airports.find(a => a.id === airportId);
    if (!ap || !ap.market[commodityId]) return null;

    const item = ap.market[commodityId];
    if (item.stock <= 0) return null;
    if (money < item.buyPrice) return null;

    item.stock--;
    return {
      commodityId,
      name: item.commodity.name,
      cost: item.buyPrice,
      weight: item.commodity.weight,
      volume: item.commodity.volume
    };
  }

  // Sell commodity at airport
  sellCommodity(airportId, commodityId) {
    const ap = this.airports.find(a => a.id === airportId);
    if (!ap) return null;

    // Can sell even if airport doesn't normally stock it (at lower price)
    let sellPrice;
    if (ap.market[commodityId]) {
      sellPrice = ap.market[commodityId].sellPrice;
      ap.market[commodityId].stock++;
    } else {
      const comm = COMMODITIES.find(c => c.id === commodityId);
      sellPrice = comm ? Math.round(comm.basePrice * 0.4) : 10;
    }

    return { commodityId, revenue: sellPrice };
  }

  getAvailableMissions(airportId) {
    return this.missions.filter(m =>
      m.fromAirport === airportId && !m.accepted && m.expiresAt > Date.now()
    );
  }

  getMarket(airportId) {
    const ap = this.airports.find(a => a.id === airportId);
    return ap ? ap.market : {};
  }
}
