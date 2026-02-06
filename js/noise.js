// Seeded Perlin Noise implementation for procedural world generation

export class SeededRandom {
  constructor(seed = 12345) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 16807 + 0) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  nextRange(min, max) {
    return min + this.next() * (max - min);
  }
  nextInt(min, max) {
    return Math.floor(this.nextRange(min, max));
  }
}

export class PerlinNoise {
  constructor(seed = 42) {
    this.seed = seed;
    this.perm = new Uint8Array(512);
    this.grad = [];
    this._init(seed);
  }

  _init(seed) {
    const rng = new SeededRandom(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
      const j = rng.nextInt(0, i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];

    // Gradient vectors
    const angles = [];
    for (let i = 0; i < 256; i++) {
      const a = rng.next() * Math.PI * 2;
      angles.push([Math.cos(a), Math.sin(a)]);
    }
    this.grad = angles;
  }

  _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  _lerp(a, b, t) { return a + t * (b - a); }

  _dot(gi, x, y) {
    const g = this.grad[gi & 255];
    return g[0] * x + g[1] * y;
  }

  noise2D(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this._fade(xf);
    const v = this._fade(yf);

    const aa = this.perm[this.perm[xi] + yi];
    const ab = this.perm[this.perm[xi] + yi + 1];
    const ba = this.perm[this.perm[xi + 1] + yi];
    const bb = this.perm[this.perm[xi + 1] + yi + 1];

    const x1 = this._lerp(this._dot(aa, xf, yf), this._dot(ba, xf - 1, yf), u);
    const x2 = this._lerp(this._dot(ab, xf, yf - 1), this._dot(bb, xf - 1, yf - 1), u);

    return this._lerp(x1, x2, v);
  }

  // Fractal Brownian Motion - layered noise for natural terrain
  fbm(x, y, octaves = 6, lacunarity = 2.0, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2D(x * freq, y * freq) * amp;
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / maxAmp;
  }

  // Ridge noise - creates sharp mountain ridges
  ridgeNoise(x, y, octaves = 6) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      let n = Math.abs(this.noise2D(x * freq, y * freq));
      n = 1.0 - n; // invert
      n = n * n; // sharpen
      sum += n * amp;
      maxAmp += amp;
      amp *= 0.5;
      freq *= 2.0;
    }
    return sum / maxAmp;
  }
}

// Biome types
export const BIOME = {
  OCEAN: 0,
  PLAINS: 1,
  MOUNTAINS: 2,
  ISLAND: 3,
  AIRPORT: 4
};

// Determine biome at world position
export function getBiome(x, z, terrainNoise, biomeNoise, islandNoise) {
  const bn = biomeNoise.fbm(x * 0.0003, z * 0.0003, 4);
  const inl = islandNoise.fbm(x * 0.002, z * 0.002, 3);

  if (bn < -0.15) {
    // Ocean zone - check for islands
    if (inl > 0.25) return BIOME.ISLAND;
    return BIOME.OCEAN;
  }
  const tn = terrainNoise.fbm(x * 0.0008, z * 0.0008, 4);
  if (tn > 0.3) return BIOME.MOUNTAINS;
  return BIOME.PLAINS;
}

// Get terrain height at world position
export function getTerrainHeight(x, z, terrainNoise, biomeNoise, islandNoise) {
  const biome = getBiome(x, z, terrainNoise, biomeNoise, islandNoise);
  const base = terrainNoise.fbm(x * 0.001, z * 0.001, 6);
  const detail = terrainNoise.fbm(x * 0.005, z * 0.005, 3) * 0.15;

  switch (biome) {
    case BIOME.OCEAN:
      return -2; // Slightly below sea level
    case BIOME.PLAINS:
      return (base * 0.5 + 0.5) * 40 + detail * 10 + 5;
    case BIOME.MOUNTAINS: {
      const ridge = terrainNoise.ridgeNoise(x * 0.001, z * 0.001, 5);
      return (base * 0.5 + 0.5) * 120 + ridge * 200 + detail * 30 + 50;
    }
    case BIOME.ISLAND: {
      const inl = islandNoise.fbm(x * 0.002, z * 0.002, 3);
      const islandHeight = Math.max(0, (inl - 0.25) * 4);
      return islandHeight * 80 + detail * 15 + 3;
    }
    default:
      return 10;
  }
}
