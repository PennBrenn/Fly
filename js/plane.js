// Low-poly glider 3D model + parts/customization system
import * as THREE from 'three';

// === PART DEFINITIONS ===
export const PARTS = {
  fuselage: {
    standard: {
      name: 'Standard',
      desc: '1 Seat, 100L Cargo',
      cargoCapacity: 100,
      mass: 80,
      dragMod: 1.0,
      cost: 0
    },
    twoseater: {
      name: '2-Seater',
      desc: '200L Cargo, +Weight',
      cargoCapacity: 200,
      mass: 120,
      dragMod: 1.05,
      cost: 500
    },
    freighter: {
      name: 'Freighter',
      desc: '500L Cargo, ++Weight, ++Drag',
      cargoCapacity: 500,
      mass: 200,
      dragMod: 1.3,
      cost: 2000
    }
  },
  wings: {
    medium: {
      name: 'Medium',
      desc: 'Balanced Lift/Drag',
      wingArea: 15,
      aspectRatio: 18,
      rollRate: 1.2,
      liftMod: 1.0,
      cost: 0
    },
    long: {
      name: 'Long',
      desc: '++Lift, --Roll Rate',
      wingArea: 22,
      aspectRatio: 28,
      rollRate: 0.6,
      liftMod: 1.3,
      cost: 800
    },
    short: {
      name: 'Short',
      desc: '--Lift, ++Roll, ++Speed',
      wingArea: 10,
      aspectRatio: 12,
      rollRate: 2.0,
      liftMod: 0.7,
      cost: 600
    }
  },
  wingtips: {
    none: {
      name: 'None',
      desc: 'Baseline',
      cd0Mod: 0,
      liftMod: 1.0,
      rollMod: 1.0,
      speedMod: 1.0,
      cost: 0
    },
    blended: {
      name: 'Blended',
      desc: '++Glide Ratio, --Turn Speed',
      cd0Mod: -0.003,
      liftMod: 1.05,
      rollMod: 0.8,
      speedMod: 1.0,
      cost: 400
    },
    drooped: {
      name: 'Drooped',
      desc: '++Climb, --Max Speed',
      cd0Mod: 0.005,
      liftMod: 1.15,
      rollMod: 0.9,
      speedMod: 0.85,
      cost: 350
    }
  }
};

// Compute physics config from part selection
export function computePhysicsConfig(planeConfig) {
  const fuse = PARTS.fuselage[planeConfig.fuselage];
  const wing = PARTS.wings[planeConfig.wings];
  const tips = PARTS.wingtips[planeConfig.wingtips];

  const baseMass = 180; // pilot + frame
  const mass = baseMass + fuse.mass;
  const wingArea = wing.wingArea;
  const aspectRatio = wing.aspectRatio;
  const cd0 = (0.015 + (tips.cd0Mod || 0)) * fuse.dragMod;
  const rollRate = wing.rollRate * (tips.rollMod || 1.0);
  const maxSpeed = (250 / 3.6) * (tips.speedMod || 1.0);
  const e = 0.85 * (tips.liftMod || 1.0);

  // Heavier = higher stall speed
  const stallSpeed = (55 / 3.6) * Math.sqrt(mass / 300);

  return {
    mass,
    cargoMass: 0,
    wingArea,
    aspectRatio,
    cd0: Math.max(0.008, cd0),
    e: Math.min(0.95, e),
    rollRate,
    pitchRate: 0.8,
    yawRate: 0.3,
    maxSpeed,
    stallSpeed,
    brakeCD: 0.05,
    cargoCapacity: fuse.cargoCapacity,
    liftMod: wing.liftMod * (tips.liftMod || 1.0)
  };
}

// === 3D MODEL BUILDER ===
export class PlaneModel {
  constructor() {
    this.group = new THREE.Group();
    this.wingBones = { left: null, right: null };
    this.config = { fuselage: 'standard', wings: 'medium', wingtips: 'none' };
    this._build();
  }

  _build() {
    // Clear existing
    while (this.group.children.length) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const cfg = this.config;
    const white = new THREE.MeshPhongMaterial({ color: 0xf0f0f0, flatShading: true });
    const accent = new THREE.MeshPhongMaterial({ color: 0x4ecdc4, flatShading: true });
    const dark = new THREE.MeshPhongMaterial({ color: 0x333333, flatShading: true });
    const canopyMat = new THREE.MeshPhongMaterial({
      color: 0x88ccff, transparent: true, opacity: 0.6, flatShading: true
    });

    // Fuselage dimensions based on type
    let fuseLen = 6, fuseW = 0.5, fuseH = 0.5;
    if (cfg.fuselage === 'twoseater') { fuseLen = 7; fuseW = 0.6; fuseH = 0.55; }
    if (cfg.fuselage === 'freighter') { fuseLen = 8; fuseW = 0.8; fuseH = 0.7; }

    // Fuselage - tapered cylinder approximation using a custom shape
    const fuseGeo = new THREE.CylinderGeometry(fuseH * 0.3, fuseH, fuseLen, 6, 1);
    fuseGeo.rotateZ(Math.PI / 2);
    fuseGeo.rotateY(Math.PI / 2);
    const fuse = new THREE.Mesh(fuseGeo, white);
    fuse.castShadow = true;
    this.group.add(fuse);

    // Nose cone
    const noseGeo = new THREE.ConeGeometry(fuseH * 0.35, 1.2, 6);
    noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, accent);
    nose.position.z = -fuseLen / 2 - 0.5;
    nose.castShadow = true;
    this.group.add(nose);

    // Canopy
    const canopyGeo = new THREE.SphereGeometry(0.4, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, fuseH * 0.4, -fuseLen * 0.15);
    canopy.scale.set(0.8, 0.7, 1.5);
    this.group.add(canopy);

    // Wings
    let wingSpan = 7, wingChord = 1.2;
    if (cfg.wings === 'long') { wingSpan = 10; wingChord = 1.0; }
    if (cfg.wings === 'short') { wingSpan = 5; wingChord = 1.4; }

    // Left wing
    const lwGeo = this._createWingGeo(wingSpan, wingChord, -1);
    const leftWing = new THREE.Mesh(lwGeo, white);
    leftWing.castShadow = true;
    this.group.add(leftWing);
    this.wingBones.left = leftWing;

    // Right wing
    const rwGeo = this._createWingGeo(wingSpan, wingChord, 1);
    const rightWing = new THREE.Mesh(rwGeo, white);
    rightWing.castShadow = true;
    this.group.add(rightWing);
    this.wingBones.right = rightWing;

    // Wing accent stripe
    for (const side of [-1, 1]) {
      const stripeGeo = new THREE.BoxGeometry(wingSpan * 0.6, 0.02, wingChord * 0.15);
      const stripe = new THREE.Mesh(stripeGeo, accent);
      stripe.position.set(side * wingSpan * 0.35, 0.06, 0);
      this.group.add(stripe);
    }

    // Wingtips
    if (cfg.wingtips === 'blended') {
      for (const side of [-1, 1]) {
        const tipGeo = new THREE.BoxGeometry(0.3, 0.8, 0.6);
        const tip = new THREE.Mesh(tipGeo, accent);
        tip.position.set(side * (wingSpan + 0.15), 0.3, 0);
        tip.rotation.z = side * 0.3;
        this.group.add(tip);
      }
    } else if (cfg.wingtips === 'drooped') {
      for (const side of [-1, 1]) {
        const tipGeo = new THREE.BoxGeometry(0.3, 0.6, 0.8);
        const tip = new THREE.Mesh(tipGeo, accent);
        tip.position.set(side * (wingSpan + 0.15), -0.2, 0);
        tip.rotation.z = side * -0.4;
        this.group.add(tip);
      }
    }

    // Horizontal stabilizer
    const hstabGeo = new THREE.BoxGeometry(3, 0.05, 0.6);
    const hstab = new THREE.Mesh(hstabGeo, white);
    hstab.position.set(0, 0.1, fuseLen / 2 - 0.3);
    hstab.castShadow = true;
    this.group.add(hstab);

    // Vertical stabilizer
    const vstabGeo = new THREE.BoxGeometry(0.05, 1.2, 0.8);
    const vstab = new THREE.Mesh(vstabGeo, white);
    vstab.position.set(0, 0.7, fuseLen / 2 - 0.2);
    vstab.castShadow = true;
    this.group.add(vstab);

    // Rudder accent
    const rudderGeo = new THREE.BoxGeometry(0.06, 0.4, 0.3);
    const rudder = new THREE.Mesh(rudderGeo, accent);
    rudder.position.set(0, 1.1, fuseLen / 2 + 0.1);
    this.group.add(rudder);

    // Landing gear (small)
    const gearGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.3, 4);
    const gear = new THREE.Mesh(gearGeo, dark);
    gear.position.set(0, -fuseH - 0.15, -0.5);
    this.group.add(gear);

    const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.06, 6);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheel.position.set(0, -fuseH - 0.3, -0.5);
    this.group.add(wheel);
  }

  _createWingGeo(span, chord, side) {
    // Low-poly wing: tapered, slightly swept back
    const geo = new THREE.BufferGeometry();
    const tipChord = chord * 0.5;
    const sweep = chord * 0.3;
    const dihedral = 0.15;
    const s = side; // -1 left, 1 right

    // Root: at center, Tip: at span
    const vertices = new Float32Array([
      // Root leading edge
      0, 0, -chord / 2,
      // Root trailing edge
      0, 0, chord / 2,
      // Tip leading edge
      s * span, dihedral * span / 7, -tipChord / 2 - sweep,
      // Tip trailing edge
      s * span, dihedral * span / 7, tipChord / 2 - sweep,
      // Root top
      0, 0.05, 0,
      // Tip top
      s * span, dihedral * span / 7 + 0.03, -sweep
    ]);

    const indices = s > 0
      ? [0, 2, 4, 2, 5, 4, 4, 5, 3, 4, 3, 1, 0, 4, 1, 2, 3, 5]
      : [0, 4, 2, 2, 4, 5, 4, 3, 5, 4, 1, 3, 0, 1, 4, 2, 5, 3];

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  setConfig(config) {
    this.config = { ...config };
    this._build();
  }

  // Animate wing flex based on G-force
  updateWingFlex(gForce) {
    const flex = Math.max(-0.1, Math.min(0.15, (gForce - 1) * 0.06));
    if (this.wingBones.left) {
      this.wingBones.left.rotation.z = flex;
    }
    if (this.wingBones.right) {
      this.wingBones.right.rotation.z = -flex;
    }
  }

  // Update position/rotation from physics
  syncWithPhysics(physics) {
    this.group.position.copy(physics.position);
    this.group.quaternion.copy(physics.orientation);
    this.updateWingFlex(physics.getGForce());
  }
}
