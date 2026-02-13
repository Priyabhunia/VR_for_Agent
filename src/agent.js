import * as THREE from 'three';

/**
 * Agent — A simple humanoid figure built from Three.js primitives
 */
export class Agent {
    constructor(scene) {
        this.scene = scene;
        this.state = 'idle'; // idle | walking | talking
        this.group = new THREE.Group();

        // Movement
        this._targetPos = null;
        this._moveSpeed = 3; // units per second
        this._rotSpeed = 5;

        // Speech
        this._speechTimeout = null;

        this._buildBody();
        this.group.position.set(0, 0, 0);
        scene.add(this.group);
    }

    _buildBody() {
        const bodyColor = 0x4f8fff;
        const accentColor = 0x00d4ff;

        // Torso (capsule-like: cylinder + spheres)
        const torsoGeo = new THREE.CylinderGeometry(0.3, 0.25, 0.9, 8);
        const torsoMat = new THREE.MeshStandardMaterial({
            color: bodyColor,
            roughness: 0.4,
            metalness: 0.5,
            emissive: bodyColor,
            emissiveIntensity: 0.08
        });
        this.torso = new THREE.Mesh(torsoGeo, torsoMat);
        this.torso.position.y = 1.15;
        this.torso.castShadow = true;
        this.group.add(this.torso);

        // Head
        const headGeo = new THREE.SphereGeometry(0.22, 12, 12);
        const headMat = new THREE.MeshStandardMaterial({
            color: accentColor,
            roughness: 0.3,
            metalness: 0.6,
            emissive: accentColor,
            emissiveIntensity: 0.15
        });
        this.head = new THREE.Mesh(headGeo, headMat);
        this.head.position.y = 1.82;
        this.head.castShadow = true;
        this.group.add(this.head);

        // Eyes (two small spheres)
        const eyeGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.08, 1.85, 0.18);
        this.group.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.08, 1.85, 0.18);
        this.group.add(rightEye);

        // Pupils
        const pupilGeo = new THREE.SphereGeometry(0.02, 8, 8);
        const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
        leftPupil.position.set(-0.08, 1.85, 0.21);
        this.group.add(leftPupil);
        const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
        rightPupil.position.set(0.08, 1.85, 0.21);
        this.group.add(rightPupil);

        // Arms
        const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.6, 6);
        const armMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0.4 });

        this.leftArm = new THREE.Mesh(armGeo, armMat);
        this.leftArm.position.set(-0.4, 1.1, 0);
        this.leftArm.rotation.z = 0.15;
        this.leftArm.castShadow = true;
        this.group.add(this.leftArm);

        this.rightArm = new THREE.Mesh(armGeo, armMat);
        this.rightArm.position.set(0.4, 1.1, 0);
        this.rightArm.rotation.z = -0.15;
        this.rightArm.castShadow = true;
        this.group.add(this.rightArm);

        // Legs
        const legGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.7, 6);
        const legMat = new THREE.MeshStandardMaterial({ color: 0x333366, roughness: 0.6, metalness: 0.2 });

        this.leftLeg = new THREE.Mesh(legGeo, legMat);
        this.leftLeg.position.set(-0.12, 0.35, 0);
        this.leftLeg.castShadow = true;
        this.group.add(this.leftLeg);

        this.rightLeg = new THREE.Mesh(legGeo, legMat);
        this.rightLeg.position.set(0.12, 0.35, 0);
        this.rightLeg.castShadow = true;
        this.group.add(this.rightLeg);

        // Ground ring glow
        const ringGeo = new THREE.RingGeometry(0.35, 0.5, 24);
        const ringMat = new THREE.MeshBasicMaterial({
            color: accentColor,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide
        });
        this.groundRing = new THREE.Mesh(ringGeo, ringMat);
        this.groundRing.rotation.x = -Math.PI / 2;
        this.groundRing.position.y = 0.02;
        this.group.add(this.groundRing);
    }

    /* ---- Properties ---- */
    get position() {
        return this.group.position;
    }

    get rotation() {
        return this.group.rotation.y;
    }

    get isMoving() {
        return this._targetPos !== null;
    }

    /* ---- Actions ---- */
    moveTo(x, z) {
        this._targetPos = new THREE.Vector3(x, 0, z);
        this.state = 'walking';
        return { action: 'moveTo', target: { x, z }, status: 'moving' };
    }

    moveForward(distance) {
        const dir = new THREE.Vector3(0, 0, 1).applyEuler(this.group.rotation);
        const target = this.group.position.clone().add(dir.multiplyScalar(distance));
        return this.moveTo(target.x, target.z);
    }

    turnTo(angleDeg) {
        const rad = (angleDeg * Math.PI) / 180;
        this.group.rotation.y = rad;
        return { action: 'turnTo', angle: angleDeg, status: 'done' };
    }

    lookAtPosition(x, z) {
        const dx = x - this.group.position.x;
        const dz = z - this.group.position.z;
        const angle = Math.atan2(dx, dz);
        this.group.rotation.y = angle;
        return { action: 'lookAt', target: { x, z }, status: 'done' };
    }

    say(text) {
        this.state = 'talking';
        if (this._speechTimeout) clearTimeout(this._speechTimeout);
        this._speechTimeout = setTimeout(() => {
            if (this.state === 'talking') this.state = 'idle';
        }, 3000);
        return { action: 'say', text, status: 'speaking' };
    }

    getState() {
        return {
            position: {
                x: parseFloat(this.group.position.x.toFixed(2)),
                z: parseFloat(this.group.position.z.toFixed(2))
            },
            rotationDeg: parseFloat(((this.group.rotation.y * 180) / Math.PI).toFixed(1)),
            state: this.state
        };
    }

    /* ---- Update (called each frame) ---- */
    update(dt) {
        // Walk animation
        if (this._targetPos) {
            const current = this.group.position;
            const diff = new THREE.Vector3().subVectors(this._targetPos, current);
            diff.y = 0;
            const dist = diff.length();

            if (dist < 0.1) {
                // Arrived
                this.group.position.x = this._targetPos.x;
                this.group.position.z = this._targetPos.z;
                this._targetPos = null;
                this.state = 'idle';
            } else {
                // Rotate toward target
                const targetAngle = Math.atan2(diff.x, diff.z);
                let angleDiff = targetAngle - this.group.rotation.y;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                this.group.rotation.y += angleDiff * Math.min(1, this._rotSpeed * dt);

                // Move forward
                const step = Math.min(this._moveSpeed * dt, dist);
                const direction = diff.normalize();
                current.x += direction.x * step;
                current.z += direction.z * step;
            }
        }

        // Bobbing / walking animation
        const time = performance.now() / 1000;
        if (this.state === 'walking') {
            const bob = Math.sin(time * 8) * 0.04;
            this.torso.position.y = 1.15 + bob;
            this.head.position.y = 1.82 + bob;
            this.leftArm.rotation.x = Math.sin(time * 8) * 0.4;
            this.rightArm.rotation.x = Math.sin(time * 8 + Math.PI) * 0.4;
            this.leftLeg.rotation.x = Math.sin(time * 8 + Math.PI) * 0.3;
            this.rightLeg.rotation.x = Math.sin(time * 8) * 0.3;
        } else {
            // Idle breathing
            const breathe = Math.sin(time * 2) * 0.01;
            this.torso.position.y = 1.15 + breathe;
            this.head.position.y = 1.82 + breathe;
            this.leftArm.rotation.x = 0;
            this.rightArm.rotation.x = 0;
            this.leftLeg.rotation.x = 0;
            this.rightLeg.rotation.x = 0;
        }

        // Ground ring pulse
        this.groundRing.material.opacity = 0.15 + Math.sin(time * 3) * 0.1;
    }
}
