// Visual effects: wind lines, thermal visualization, clouds
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.windParticles = null;
    this.thermalParticles = [];
    this.clouds = [];
    this._createWindParticles();
    this._createClouds();
  }

  _createWindParticles() {
    // Wingtip trails - white streak particles
    const count = 200;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -1000; // hidden initially
      positions[i * 3 + 2] = 0;
      lifetimes[i] = 0;
      sizes[i] = 0.3 + Math.random() * 0.4;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.windParticles = new THREE.Points(geo, mat);
    this.scene.add(this.windParticles);

    this._windData = { velocities, lifetimes, nextIdx: 0 };
  }

  _createClouds() {
    // Simple low-poly clouds scattered around
    const cloudMat = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      flatShading: true,
      transparent: true,
      opacity: 0.7
    });

    for (let i = 0; i < 30; i++) {
      const group = new THREE.Group();
      const puffCount = 3 + Math.floor(Math.random() * 4);

      for (let j = 0; j < puffCount; j++) {
        const size = 30 + Math.random() * 60;
        const geo = new THREE.IcosahedronGeometry(size, 1);
        const puff = new THREE.Mesh(geo, cloudMat);
        puff.position.set(
          (Math.random() - 0.5) * size * 2,
          (Math.random() - 0.5) * size * 0.3,
          (Math.random() - 0.5) * size * 2
        );
        puff.scale.y = 0.4;
        group.add(puff);
      }

      const angle = Math.random() * Math.PI * 2;
      const dist = 500 + Math.random() * 5000;
      group.position.set(
        Math.cos(angle) * dist,
        600 + Math.random() * 1200,
        Math.sin(angle) * dist
      );
      group.userData.baseX = group.position.x;
      group.userData.baseZ = group.position.z;
      group.userData.speed = 0.5 + Math.random() * 1.5;

      this.clouds.push(group);
      this.scene.add(group);
    }
  }

  // Emit wind particles from wingtips when fast
  emitWindLines(planePos, planeQuat, speed) {
    if (speed < 100 / 3.6) return; // only above 100 km/h

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(planeQuat);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
    const positions = this.windParticles.geometry.attributes.position.array;
    const { velocities, lifetimes } = this._windData;

    for (let side = -1; side <= 1; side += 2) {
      const idx = this._windData.nextIdx;
      this._windData.nextIdx = (idx + 1) % (positions.length / 3);

      // Spawn at wingtip
      const offset = right.clone().multiplyScalar(side * 7);
      const spawnPos = planePos.clone().add(offset);

      positions[idx * 3] = spawnPos.x;
      positions[idx * 3 + 1] = spawnPos.y;
      positions[idx * 3 + 2] = spawnPos.z;

      // Velocity: backward + slight outward spread
      velocities[idx * 3] = -forward.x * speed * 0.3 + (Math.random() - 0.5) * 2;
      velocities[idx * 3 + 1] = -forward.y * speed * 0.3 + (Math.random() - 0.5);
      velocities[idx * 3 + 2] = -forward.z * speed * 0.3 + (Math.random() - 0.5) * 2;

      lifetimes[idx] = 0.5 + Math.random() * 0.3;
    }
  }

  // Create thermal dust particles at position
  spawnThermalDust(x, y, z, strength) {
    // Reuse existing or create new
    if (this.thermalParticles.length > 10) return;

    const count = 50;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const vels = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 30;
      positions[i * 3] = x + Math.cos(angle) * r;
      positions[i * 3 + 1] = y + Math.random() * 50;
      positions[i * 3 + 2] = z + Math.sin(angle) * r;
      // Spiral upward
      vels[i * 3] = Math.cos(angle + 1) * 2;
      vels[i * 3 + 1] = strength * 2;
      vels[i * 3 + 2] = Math.sin(angle + 1) * 2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xddcc88,
      size: 2,
      transparent: true,
      opacity: 0.3,
      sizeAttenuation: true,
      depthWrite: false
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.thermalParticles.push({ points, vels, life: 5 });
  }

  update(dt, playerPos, windDir) {
    // Update wind particles
    const positions = this.windParticles.geometry.attributes.position.array;
    const { velocities, lifetimes } = this._windData;
    const count = positions.length / 3;

    for (let i = 0; i < count; i++) {
      if (lifetimes[i] > 0) {
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        lifetimes[i] -= dt;
        if (lifetimes[i] <= 0) {
          positions[i * 3 + 1] = -1000;
        }
      }
    }
    this.windParticles.geometry.attributes.position.needsUpdate = true;

    // Update thermal particles
    for (let i = this.thermalParticles.length - 1; i >= 0; i--) {
      const tp = this.thermalParticles[i];
      tp.life -= dt;
      if (tp.life <= 0) {
        this.scene.remove(tp.points);
        tp.points.geometry.dispose();
        tp.points.material.dispose();
        this.thermalParticles.splice(i, 1);
        continue;
      }

      const pos = tp.points.geometry.attributes.position.array;
      const n = pos.length / 3;
      for (let j = 0; j < n; j++) {
        pos[j * 3] += tp.vels[j * 3] * dt;
        pos[j * 3 + 1] += tp.vels[j * 3 + 1] * dt;
        pos[j * 3 + 2] += tp.vels[j * 3 + 2] * dt;
        // Spiral
        const t = performance.now() * 0.001;
        pos[j * 3] += Math.sin(t + j) * 0.5 * dt;
        pos[j * 3 + 2] += Math.cos(t + j) * 0.5 * dt;
      }
      tp.points.geometry.attributes.position.needsUpdate = true;
      tp.points.material.opacity = Math.min(0.3, tp.life * 0.1);
    }

    // Drift clouds
    const t = performance.now() * 0.0001;
    for (const cloud of this.clouds) {
      // Slow incremental wind drift
      cloud.userData.baseX += windDir.x * cloud.userData.speed * dt * 5;
      cloud.userData.baseZ += windDir.z * cloud.userData.speed * dt * 5;

      // Oscillation as pure offset (not accumulated)
      cloud.position.x = cloud.userData.baseX + Math.sin(t * cloud.userData.speed) * 50;
      cloud.position.z = cloud.userData.baseZ;

      // Wrap clouds around player
      const dx = cloud.position.x - playerPos.x;
      const dz = cloud.position.z - playerPos.z;
      if (Math.abs(dx) > 5000) cloud.userData.baseX -= Math.sign(dx) * 10000;
      if (Math.abs(dz) > 5000) cloud.userData.baseZ -= Math.sign(dz) * 10000;
      cloud.position.x = cloud.userData.baseX + Math.sin(t * cloud.userData.speed) * 50;
      cloud.position.z = cloud.userData.baseZ;
    }
  }

  dispose() {
    if (this.windParticles) {
      this.scene.remove(this.windParticles);
      this.windParticles.geometry.dispose();
      this.windParticles.material.dispose();
    }
    for (const tp of this.thermalParticles) {
      this.scene.remove(tp.points);
      tp.points.geometry.dispose();
      tp.points.material.dispose();
    }
    for (const c of this.clouds) {
      this.scene.remove(c);
      c.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this.thermalParticles = [];
    this.clouds = [];
  }
}
