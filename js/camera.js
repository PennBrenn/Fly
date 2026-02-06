// Third-person follow camera with smooth interpolation
import * as THREE from 'three';

export class GameCamera {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.offset = new THREE.Vector3(0, 4, 15); // behind and above
    this.lookOffset = new THREE.Vector3(0, 1, -10); // look ahead of plane
    this.smoothness = 4; // higher = stiffer follow
    this.currentPos = new THREE.Vector3();
    this.currentLook = new THREE.Vector3();
    this.shakeAmount = 0;
    this.shakeDecay = 3;
  }

  // Set camera for landed state (higher view)
  setLandedView(position, heading) {
    const offset = new THREE.Vector3(0, 8, 25);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.camera.position.copy(position).add(offset);
    this.camera.lookAt(position.clone().add(new THREE.Vector3(0, 2, 0)));
    this.currentPos.copy(this.camera.position);
    this.currentLook.copy(position);
  }

  update(dt, planePosition, planeQuaternion, speed) {
    // Compute desired camera position (behind plane)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(planeQuaternion);

    // Dynamic offset based on speed - camera pulls back at higher speed
    const speedFactor = Math.min(1.5, speed / 30);
    const dynamicBack = this.offset.z * (1 + speedFactor * 0.3);
    const dynamicUp = this.offset.y * (1 + speedFactor * 0.15);

    const desiredPos = planePosition.clone()
      .addScaledVector(forward, -dynamicBack)
      .addScaledVector(up, dynamicUp);

    // Smooth follow
    const t = 1 - Math.exp(-this.smoothness * dt);
    this.currentPos.lerp(desiredPos, t);

    // Look target: slightly ahead of plane
    const lookTarget = planePosition.clone()
      .addScaledVector(forward, 15);
    this.currentLook.lerp(lookTarget, t * 1.2);

    // Camera shake (turbulence)
    if (this.shakeAmount > 0) {
      const shake = new THREE.Vector3(
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount * 0.5,
        (Math.random() - 0.5) * this.shakeAmount
      );
      this.currentPos.add(shake);
      this.shakeAmount = Math.max(0, this.shakeAmount - this.shakeDecay * dt);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
  }

  addShake(amount) {
    this.shakeAmount = Math.min(3, this.shakeAmount + amount);
  }
}
