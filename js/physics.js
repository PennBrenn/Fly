// Flight physics: aerodynamics, forces, thermal/ridge lift, landing/crash
import * as THREE from 'three';

// Atmospheric constants
const RHO = 1.225;       // air density at sea level (kg/m³)
const G = 9.81;          // gravity (m/s²)

// Angle of attack -> CL lookup (simplified)
function getCL(aoa) {
  // aoa in radians
  const deg = aoa * (180 / Math.PI);
  if (deg < -10) return -0.4;
  if (deg > 18) return 0.8 - (deg - 18) * 0.1; // stall
  // Linear region: CL ~= 2π * aoa (thin airfoil) clamped
  return Math.min(1.6, Math.max(-0.5, 0.1 + deg * 0.1));
}

function getCD(cl, aspectRatio, cd0, e) {
  // Parasitic + Induced drag
  const cdi = (cl * cl) / (Math.PI * aspectRatio * e);
  return cd0 + cdi;
}

export class FlightPhysics {
  constructor() {
    // State
    this.position = new THREE.Vector3(0, 300, 0);
    this.velocity = new THREE.Vector3(0, 0, -20); // initial forward speed
    this.orientation = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3(0, 0, 0);

    // Control inputs [-1, 1]
    this.pitchInput = 0;
    this.rollInput = 0;
    this.yawInput = 0;
    this.brakeInput = 0; // speed brake [0,1]

    // Plane configuration (set by plane.js)
    this.config = this._defaultConfig();

    // State flags
    this.isLaunching = false;
    this.launchThrust = 0;
    this.launchTimer = 0;
    this.stalling = false;
    this.crashed = false;
    this.landed = true;

    // Thermal tracking
    this.thermalHeatTime = 0; // cumulative time in hot thermals
    this.currentTemp = 15;
    this.cargoSpoiled = false;

    // Turbulence
    this.turbulenceOffset = new THREE.Vector3();
  }

  _defaultConfig() {
    return {
      mass: 300,          // kg (base plane + pilot)
      cargoMass: 0,       // kg
      wingArea: 15,       // m²
      aspectRatio: 18,    // span²/area
      cd0: 0.015,         // parasitic drag coefficient
      e: 0.85,            // Oswald efficiency
      rollRate: 1.2,      // rad/s max
      pitchRate: 0.8,     // rad/s max
      yawRate: 0.3,       // rad/s max
      maxSpeed: 250 / 3.6, // m/s (~250 km/h)
      stallSpeed: 60 / 3.6, // m/s (~60 km/h)
      brakeCD: 0.05       // additional CD when brake deployed
    };
  }

  setConfig(config) {
    Object.assign(this.config, config);
  }

  get totalMass() {
    return this.config.mass + this.config.cargoMass;
  }

  get speed() {
    return this.velocity.length();
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  get verticalSpeed() {
    return this.velocity.y;
  }

  get altitude() {
    return this.position.y;
  }

  // Get forward direction from orientation
  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation).normalize();
  }

  get up() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.orientation).normalize();
  }

  get right() {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.orientation).normalize();
  }

  // Calculate angle of attack
  getAngleOfAttack() {
    if (this.speed < 0.1) return 0;
    const velDir = this.velocity.clone().normalize();
    const fwd = this.forward;
    // AoA = angle between velocity and forward in the pitch plane
    const dot = velDir.dot(fwd);
    const cross = velDir.clone().cross(fwd);
    const sign = cross.dot(this.right) > 0 ? 1 : -1;
    return sign * Math.acos(Math.min(1, Math.max(-1, dot)));
  }

  launch(type) {
    this.landed = false;
    this.crashed = false;
    this.isLaunching = true;
    this.cargoSpoiled = false;
    this.thermalHeatTime = 0;

    if (type === 'cable') {
      this.launchThrust = this.totalMass * G * 1.5;
      this.launchTimer = 4; // seconds of thrust
      this.velocity.copy(this.forward.multiplyScalar(15));
    } else {
      // Aerotow - higher and longer
      this.launchThrust = this.totalMass * G * 1.2;
      this.launchTimer = 15;
      this.velocity.copy(this.forward.multiplyScalar(25));
    }
  }

  resetAt(airport) {
    this.position.set(airport.x, airport.elevation + 2, airport.z);
    this.velocity.set(0, 0, 0);
    this.orientation.setFromEuler(new THREE.Euler(0, airport.heading, 0));
    this.angularVelocity.set(0, 0, 0);
    this.landed = true;
    this.crashed = false;
    this.isLaunching = false;
    this.stalling = false;
    this.thermalHeatTime = 0;
    this.cargoSpoiled = false;
    this.currentTemp = 15;
    this.turbulenceOffset.set(0, 0, 0);
  }

  update(dt, world) {
    if (this.landed || this.crashed) return;

    const cfg = this.config;
    const mass = this.totalMass;
    const v = this.speed;
    const q = 0.5 * RHO * v * v; // dynamic pressure

    // --- Orientation update from controls ---
    const rollTorque = this.rollInput * cfg.rollRate;
    const pitchTorque = this.pitchInput * cfg.pitchRate;
    const yawTorque = this.yawInput * cfg.yawRate;

    // Apply angular velocity
    this.angularVelocity.set(pitchTorque, yawTorque, -rollTorque);

    // Create rotation delta
    const dq = new THREE.Quaternion();
    const av = this.angularVelocity.clone().multiplyScalar(dt);
    dq.setFromEuler(new THREE.Euler(av.x, av.y, av.z, 'YXZ'));
    this.orientation.multiply(dq);
    this.orientation.normalize();

    // --- Aerodynamic forces ---
    const forces = new THREE.Vector3(0, 0, 0);

    // Gravity
    forces.y -= mass * G;

    // Angle of attack
    const aoa = this.getAngleOfAttack();
    const cl = getCL(aoa);
    const cd = getCD(cl, cfg.aspectRatio, cfg.cd0, cfg.e) + (this.brakeInput * cfg.brakeCD);

    // Lift force (perpendicular to velocity, in plane's up direction)
    const liftMag = cl * q * cfg.wingArea;
    const velDir = v > 0.5 ? this.velocity.clone().normalize() : this.forward.clone().negate();
    // Lift direction: perpendicular to velocity, biased toward plane up
    const liftDir = this.up.clone();
    // Remove component along velocity
    liftDir.addScaledVector(velDir, -liftDir.dot(velDir));
    liftDir.normalize();
    forces.addScaledVector(liftDir, liftMag);

    // Drag force (opposite to velocity)
    const dragMag = cd * q * cfg.wingArea;
    if (v > 0.5) {
      forces.addScaledVector(velDir, -dragMag);
    }

    // Launch thrust
    if (this.isLaunching && this.launchTimer > 0) {
      const thrustDir = this.forward.clone();
      thrustDir.y = Math.max(thrustDir.y, 0.3); // pull upward
      thrustDir.normalize();
      forces.addScaledVector(thrustDir, this.launchThrust);
      this.launchTimer -= dt;
      if (this.launchTimer <= 0) {
        this.isLaunching = false;
        this.launchThrust = 0;
      }
    }

    // --- Environmental forces ---
    if (world) {
      const thermal = world.getThermalLift(this.position.x, this.position.y, this.position.z);

      // Thermal lift
      if (thermal.lift !== 0) {
        forces.y += thermal.lift * mass * 0.5; // Converted to force
      }

      // Temperature tracking
      this.currentTemp = thermal.temperature;
      if (thermal.temperature > 30) {
        this.thermalHeatTime += dt;
        if (this.thermalHeatTime > 10) {
          this.cargoSpoiled = true;
        }
      }

      // Turbulence
      if (thermal.turbulence > 0) {
        const t = performance.now() * 0.003;
        this.turbulenceOffset.set(
          Math.sin(t * 3.7) * thermal.turbulence * 2,
          Math.sin(t * 2.3) * thermal.turbulence * 1.5,
          Math.sin(t * 4.1) * thermal.turbulence * 2
        );
        forces.add(this.turbulenceOffset.clone().multiplyScalar(mass * 0.5));
      }

      // Wind
      forces.addScaledVector(world.windDirection, world.windSpeed * mass * 0.02);
    }

    // --- Stall detection ---
    const aoaDeg = Math.abs(aoa * 180 / Math.PI);
    this.stalling = aoaDeg > 16 || v < cfg.stallSpeed * 0.9;

    // If stalling, nose drops
    if (this.stalling && v < cfg.stallSpeed) {
      const stallPitch = new THREE.Quaternion();
      stallPitch.setFromEuler(new THREE.Euler(dt * 0.5, 0, 0));
      this.orientation.multiply(stallPitch);
    }

    // --- Integrate ---
    const accel = forces.divideScalar(mass);
    this.velocity.addScaledVector(accel, dt);

    // Speed clamp
    if (this.speed > cfg.maxSpeed) {
      this.velocity.normalize().multiplyScalar(cfg.maxSpeed);
    }

    this.position.addScaledVector(this.velocity, dt);

    // --- Ground collision ---
    if (world) {
      const groundH = world.getHeightAt(this.position.x, this.position.z);
      const airport = world.getAirportAt(this.position.x, this.position.y, this.position.z);

      if (this.position.y <= groundH + 1) {
        const vSpeed = Math.abs(this.verticalSpeed);
        const hSpeed = this.speedKmh;

        if (airport && vSpeed < 2.0 && hSpeed < 40) {
          // Successful landing
          this.position.y = airport.elevation + 1;
          this.velocity.multiplyScalar(0.95); // decelerate
          if (this.speedKmh < 2) {
            this.velocity.set(0, 0, 0);
            this.landed = true;
            return 'landed';
          }
          return 'landing'; // still rolling
        } else {
          // Crash
          this.crashed = true;
          this.velocity.set(0, 0, 0);
          this.position.y = groundH + 2;
          return 'crashed';
        }
      }
    }

    return 'flying';
  }

  // Get G-force for wing flex calculation
  getGForce() {
    if (this.speed < 1) return 1;
    const aoa = this.getAngleOfAttack();
    const cl = getCL(aoa);
    const q = 0.5 * RHO * this.speed * this.speed;
    const lift = cl * q * this.config.wingArea;
    return lift / (this.totalMass * G);
  }
}
