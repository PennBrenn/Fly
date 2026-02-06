// World generation: terrain chunks, biomes, airports, thermals
import * as THREE from 'three';
import { PerlinNoise, SeededRandom, BIOME, getBiome, getTerrainHeight } from './noise.js';

const CHUNK_SIZE = 256;      // meters per chunk
const CHUNK_RES = 64;        // vertices per chunk edge
const VIEW_DIST = 8;         // chunks visible in each direction
const SEA_LEVEL = 0;

// Biome colors
const BIOME_COLORS = {
  [BIOME.OCEAN]: new THREE.Color(0x1a6baa),
  [BIOME.PLAINS]: new THREE.Color(0x6db34f),
  [BIOME.MOUNTAINS]: new THREE.Color(0x8a8a7a),
  [BIOME.ISLAND]: new THREE.Color(0xd4b86a),
  [BIOME.AIRPORT]: new THREE.Color(0x555555)
};

const MOUNTAIN_SNOW = new THREE.Color(0xe8e8ee);
const MOUNTAIN_ROCK = new THREE.Color(0x6a6a5a);
const PLAINS_DARK = new THREE.Color(0x4a8a30);
const ISLAND_BEACH = new THREE.Color(0xf0e68c);

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.terrainNoise = new PerlinNoise(seed);
    this.biomeNoise = new PerlinNoise(seed + 100);
    this.islandNoise = new PerlinNoise(seed + 200);
    this.thermalNoise = new PerlinNoise(seed + 300);

    this.chunks = new Map();
    this.airports = [];
    this.thermals = [];
    this.windDirection = new THREE.Vector3(1, 0, 0.3).normalize();
    this.windSpeed = 5; // m/s

    // Ocean plane
    this.oceanMesh = this._createOcean();
    scene.add(this.oceanMesh);

    // Generate airports
    this._generateAirports();
    this._generateThermals();
  }

  _createOcean() {
    const geo = new THREE.PlaneGeometry(20000, 20000, 1, 1);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x0e5a8a,
      shininess: 80,
      transparent: true,
      opacity: 0.85,
      flatShading: true
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = SEA_LEVEL - 0.5;
    mesh.receiveShadow = true;
    return mesh;
  }

  _generateAirports() {
    const rng = new SeededRandom(this.seed + 500);
    const count = 12;
    const minDist = 1500;

    // First airport near origin
    this.airports.push(this._createAirportData(0, 0, rng, 0));

    let attempts = 0;
    while (this.airports.length < count && attempts < 500) {
      attempts++;
      const angle = rng.next() * Math.PI * 2;
      const dist = 1500 + rng.next() * 6000;
      const ax = Math.cos(angle) * dist;
      const az = Math.sin(angle) * dist;

      // Check biome - not in ocean
      const biome = getBiome(ax, az, this.terrainNoise, this.biomeNoise, this.islandNoise);
      if (biome === BIOME.OCEAN) continue;

      // Check distance from other airports
      let tooClose = false;
      for (const ap of this.airports) {
        const d = Math.sqrt((ax - ap.x) ** 2 + (az - ap.z) ** 2);
        if (d < minDist) { tooClose = true; break; }
      }
      if (tooClose) continue;

      this.airports.push(this._createAirportData(ax, az, rng, this.airports.length));
    }
  }

  _createAirportData(x, z, rng, id) {
    const heading = rng.next() * Math.PI;
    const h = getTerrainHeight(x, z, this.terrainNoise, this.biomeNoise, this.islandNoise);
    const elevation = Math.max(h, 5);
    const names = [
      'Skyport Alpha', 'Eagle Field', 'Thermal Valley', 'Ridge Station',
      'Windward Strip', 'Coastal Air', 'Summit Base', 'Plains Central',
      'Volcano Point', 'Island Hop', 'Canyon Port', 'Highland Field',
      'Lakeview Strip', 'Desert Oasis', 'Forest Clearing', 'Mesa Top'
    ];
    return {
      id,
      name: names[id % names.length],
      x, z,
      elevation,
      heading,
      length: 200,
      width: 30,
      mesh: null, // created when chunk loads
      biome: getBiome(x, z, this.terrainNoise, this.biomeNoise, this.islandNoise)
    };
  }

  _generateThermals() {
    const rng = new SeededRandom(this.seed + 700);
    const count = 80;

    for (let i = 0; i < count; i++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = rng.next() * 8000;
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;

      const biome = getBiome(tx, tz, this.terrainNoise, this.biomeNoise, this.islandNoise);
      if (biome === BIOME.OCEAN) continue;

      let strength, radius, maxAlt, temperature;
      switch (biome) {
        case BIOME.PLAINS:
          strength = 2 + rng.next() * 3;  // 2-5 m/s
          radius = 80 + rng.next() * 120;
          maxAlt = 1500 + rng.next() * 500;
          temperature = 25 + rng.next() * 10;
          break;
        case BIOME.MOUNTAINS:
          strength = 3 + rng.next() * 4;
          radius = 60 + rng.next() * 100;
          maxAlt = 3000 + rng.next() * 1000;
          temperature = 20 + rng.next() * 8;
          break;
        case BIOME.ISLAND:
          // Volcano thermal - very strong
          strength = 6 + rng.next() * 6;
          radius = 40 + rng.next() * 60;
          maxAlt = 4000 + rng.next() * 1000;
          temperature = 40 + rng.next() * 15; // hot
          break;
        default:
          strength = 2 + rng.next() * 2;
          radius = 80 + rng.next() * 80;
          maxAlt = 1200;
          temperature = 22;
      }

      this.thermals.push({
        x: tx, z: tz, strength, radius, maxAlt, temperature, biome,
        turbulence: biome === BIOME.ISLAND ? 0.5 + rng.next() * 0.5 : rng.next() * 0.3,
        active: true
      });
    }
  }

  // Get thermal lift at a world position
  getThermalLift(x, y, z) {
    let totalLift = 0;
    let maxTemp = 15; // ambient
    let turbulence = 0;

    const biome = getBiome(x, z, this.terrainNoise, this.biomeNoise, this.islandNoise);

    // Ocean sink zone
    if (biome === BIOME.OCEAN) {
      return { lift: -1.5, temperature: 12, turbulence: 0.1 };
    }

    for (const th of this.thermals) {
      const dx = x - th.x;
      const dz = z - th.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < th.radius && y < th.maxAlt) {
        // Gaussian falloff from center
        const factor = Math.exp(-(dist * dist) / (2 * (th.radius * 0.5) ** 2));
        // Altitude falloff
        const altFactor = 1 - (y / th.maxAlt);
        const lift = th.strength * factor * Math.max(0, altFactor);
        totalLift += lift;
        maxTemp = Math.max(maxTemp, th.temperature * factor);
        turbulence = Math.max(turbulence, th.turbulence * factor);
      }
    }

    // Ridge lift from mountains
    if (biome === BIOME.MOUNTAINS) {
      const ridgeLift = this._getRidgeLift(x, y, z);
      totalLift += ridgeLift;
    }

    return { lift: totalLift, temperature: maxTemp, turbulence };
  }

  _getRidgeLift(x, y, z) {
    // Sample terrain gradient for slope direction
    const s = 20;
    const h0 = getTerrainHeight(x, z, this.terrainNoise, this.biomeNoise, this.islandNoise);
    const hx = getTerrainHeight(x + s, z, this.terrainNoise, this.biomeNoise, this.islandNoise);
    const hz = getTerrainHeight(x, z + s, this.terrainNoise, this.biomeNoise, this.islandNoise);

    const slopeX = (hx - h0) / s;
    const slopeZ = (hz - h0) / s;

    // Normal of the terrain surface
    const normal = new THREE.Vector3(-slopeX, 1, -slopeZ).normalize();

    // Ridge lift = wind dot normal (windward side gets lift)
    const heightAboveTerrain = y - h0;
    if (heightAboveTerrain < 0 || heightAboveTerrain > 300) return 0;

    const windComponent = this.windDirection.dot(new THREE.Vector3(normal.x, 0, normal.z));
    if (windComponent <= 0) return 0; // leeward side

    const proximity = 1 - heightAboveTerrain / 300;
    return windComponent * this.windSpeed * 0.4 * proximity;
  }

  getHeightAt(x, z) {
    return getTerrainHeight(x, z, this.terrainNoise, this.biomeNoise, this.islandNoise);
  }

  getBiomeAt(x, z) {
    return getBiome(x, z, this.terrainNoise, this.biomeNoise, this.islandNoise);
  }

  // Check if position is on an airport
  getAirportAt(x, y, z) {
    for (const ap of this.airports) {
      const dx = x - ap.x;
      const dz = z - ap.z;

      // Rotate into runway local space
      const cos = Math.cos(-ap.heading);
      const sin = Math.sin(-ap.heading);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;

      const halfLen = ap.length / 2;
      const halfWid = ap.width / 2;

      if (Math.abs(lx) < halfLen && Math.abs(lz) < halfWid) {
        const altDiff = Math.abs(y - ap.elevation);
        if (altDiff < 10) return ap;
      }
    }
    return null;
  }

  // Update visible chunks around player
  update(playerX, playerZ) {
    const cx = Math.floor(playerX / CHUNK_SIZE);
    const cz = Math.floor(playerZ / CHUNK_SIZE);

    this.oceanMesh.position.x = playerX;
    this.oceanMesh.position.z = playerZ;

    // Add new chunks
    for (let dx = -VIEW_DIST; dx <= VIEW_DIST; dx++) {
      for (let dz = -VIEW_DIST; dz <= VIEW_DIST; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        if (!this.chunks.has(key)) {
          const chunk = this._createChunk(cx + dx, cz + dz);
          this.chunks.set(key, chunk);
          this.scene.add(chunk.mesh);
        }
      }
    }

    // Remove distant chunks
    for (const [key, chunk] of this.chunks) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.abs(kx - cx) > VIEW_DIST + 2 || Math.abs(kz - cz) > VIEW_DIST + 2) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
        this.chunks.delete(key);
      }
    }
  }

  _createChunk(chunkX, chunkZ) {
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES - 1, CHUNK_RES - 1);
    geo.rotateX(-Math.PI / 2);

    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const color = new THREE.Color();

    const originX = chunkX * CHUNK_SIZE;
    const originZ = chunkZ * CHUNK_SIZE;

    for (let i = 0; i < positions.count; i++) {
      const lx = positions.getX(i);
      const lz = positions.getZ(i);
      const wx = originX + lx;
      const wz = originZ + lz;

      let h = getTerrainHeight(wx, wz, this.terrainNoise, this.biomeNoise, this.islandNoise);
      const biome = getBiome(wx, wz, this.terrainNoise, this.biomeNoise, this.islandNoise);

      // Check if this is on an airport
      let onAirport = false;
      for (const ap of this.airports) {
        const dx = wx - ap.x;
        const dz = wz - ap.z;
        const cos = Math.cos(-ap.heading);
        const sin = Math.sin(-ap.heading);
        const llx = dx * cos - dz * sin;
        const llz = dx * sin + dz * cos;
        if (Math.abs(llx) < ap.length / 2 + 5 && Math.abs(llz) < ap.width / 2 + 5) {
          h = ap.elevation;
          onAirport = true;
          break;
        }
      }

      // Clamp ocean terrain below sea level
      if (biome === BIOME.OCEAN) h = Math.min(h, SEA_LEVEL - 1);

      positions.setY(i, h);

      // Color based on biome and height
      if (onAirport) {
        color.set(0x555555);
      } else {
        switch (biome) {
          case BIOME.OCEAN:
            color.copy(BIOME_COLORS[BIOME.OCEAN]);
            break;
          case BIOME.PLAINS:
            color.lerpColors(PLAINS_DARK, BIOME_COLORS[BIOME.PLAINS], Math.min(1, h / 40));
            break;
          case BIOME.MOUNTAINS:
            if (h > 300) color.copy(MOUNTAIN_SNOW);
            else if (h > 180) color.lerpColors(MOUNTAIN_ROCK, MOUNTAIN_SNOW, (h - 180) / 120);
            else color.lerpColors(BIOME_COLORS[BIOME.PLAINS], MOUNTAIN_ROCK, (h - 50) / 130);
            break;
          case BIOME.ISLAND:
            if (h < 8) color.copy(ISLAND_BEACH);
            else color.lerpColors(ISLAND_BEACH, BIOME_COLORS[BIOME.PLAINS], Math.min(1, (h - 8) / 30));
            break;
          default:
            color.set(0x80a060);
        }
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      flatShading: true,
      shininess: 5
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(originX, 0, originZ);
    mesh.receiveShadow = true;
    mesh.castShadow = false;

    // Add runway markings for airports in this chunk
    const group = new THREE.Group();
    group.add(mesh);

    for (const ap of this.airports) {
      if (Math.abs(ap.x - originX) < CHUNK_SIZE && Math.abs(ap.z - originZ) < CHUNK_SIZE) {
        const runway = this._createRunwayMarkings(ap);
        group.add(runway);
      }
    }

    return { mesh: group, chunkX, chunkZ };
  }

  _createRunwayMarkings(airport) {
    const group = new THREE.Group();

    // Main runway strip (darker)
    const stripGeo = new THREE.PlaneGeometry(airport.length, airport.width);
    stripGeo.rotateX(-Math.PI / 2);
    const stripMat = new THREE.MeshPhongMaterial({ color: 0x333333, flatShading: true });
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.set(airport.x, airport.elevation + 0.1, airport.z);
    strip.rotation.y = airport.heading;
    group.add(strip);

    // Center line
    const lineGeo = new THREE.PlaneGeometry(airport.length * 0.8, 1);
    lineGeo.rotateX(-Math.PI / 2);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(airport.x, airport.elevation + 0.15, airport.z);
    line.rotation.y = airport.heading;
    group.add(line);

    // Threshold markings
    for (let side = -1; side <= 1; side += 2) {
      const thGeo = new THREE.PlaneGeometry(15, 2);
      thGeo.rotateX(-Math.PI / 2);
      const thMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const th = new THREE.Mesh(thGeo, thMat);
      const offset = side * (airport.length / 2 - 10);
      th.position.set(
        airport.x + Math.cos(airport.heading) * offset,
        airport.elevation + 0.15,
        airport.z + Math.sin(airport.heading) * offset
      );
      th.rotation.y = airport.heading;
      group.add(th);
    }

    // Airport label (simple billboard later handled by UI)
    airport.worldPos = new THREE.Vector3(airport.x, airport.elevation + 15, airport.z);

    return group;
  }

  // For minimap rendering
  getMinimapData(cx, cz, radius) {
    const data = [];
    const step = 20;
    for (let x = cx - radius; x < cx + radius; x += step) {
      for (let z = cz - radius; z < cz + radius; z += step) {
        const biome = this.getBiomeAt(x, z);
        const thermal = this.getThermalLift(x, 500, z);
        data.push({ x, z, biome, lift: thermal.lift });
      }
    }
    return data;
  }

  dispose() {
    for (const [, chunk] of this.chunks) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this.chunks.clear();
    this.scene.remove(this.oceanMesh);
    this.oceanMesh.geometry.dispose();
    this.oceanMesh.material.dispose();
  }
}
