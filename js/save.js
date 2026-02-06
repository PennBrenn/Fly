// localStorage persistence module

const SAVE_KEY = 'glider_tycoon_save';

export const DEFAULT_STATE = {
  money: 1000,
  planeConfig: {
    fuselage: 'standard',
    wings: 'medium',
    wingtips: 'none'
  },
  currentAirport: 0,
  unlockedAirports: [0],
  position: { x: 0, y: 0, z: 0 },
  worldSeed: Math.floor(Math.random() * 999999),
  cargo: [],
  totalFlights: 0,
  totalDistance: 0,
  missionHistory: []
};

export function saveGame(state) {
  try {
    const data = {
      money: state.money,
      planeConfig: { ...state.planeConfig },
      currentAirport: state.currentAirport,
      unlockedAirports: [...state.unlockedAirports],
      position: { ...state.position },
      worldSeed: state.worldSeed,
      cargo: [...state.cargo],
      totalFlights: state.totalFlights,
      totalDistance: state.totalDistance,
      missionHistory: state.missionHistory ? [...state.missionHistory] : []
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('Save failed:', e);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...data };
  } catch (e) {
    console.warn('Load failed:', e);
    return null;
  }
}

export function deleteSave() {
  localStorage.removeItem(SAVE_KEY);
}

export function hasSave() {
  return localStorage.getItem(SAVE_KEY) !== null;
}
