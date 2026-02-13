import * as THREE from 'three';

/**
 * World — A rich virtual house environment with real-life objects
 */
export class World {
  constructor(canvas) {
    this.objects = new Map();
    this.scene = new THREE.Scene();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.camera.position.set(18, 14, 18);
    this.camera.lookAt(0, 0, 0);

    // Orbit controls state
    this._orbitAngle = Math.PI / 4;
    this._orbitPitch = 0.6;
    this._orbitDist = 22;
    this._orbitTarget = new THREE.Vector3(0, 0, 0);
    this._isDragging = false;
    this._isPanning = false;
    this._lastMouse = { x: 0, y: 0 };
    this._followAgent = true;
    this._onFollowChange = null; // callback for UI sync
    this._defaultOrbitAngle = Math.PI / 4;
    this._defaultOrbitPitch = 0.6;
    this._defaultOrbitDist = 22;
    this._agentPos = new THREE.Vector3(0, 0, 0);
    this._spaceHeld = false;
    this._setupOrbitControls(canvas);

    this._buildEnvironment();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /* ---- Orbit Controls (CAD-style) ---- */
  _setupOrbitControls(canvas) {
    // ---- Pointer down ----
    canvas.addEventListener('pointerdown', (e) => {
      this._lastMouse = { x: e.clientX, y: e.clientY };
      // Middle mouse button = pan
      if (e.button === 1) {
        this._isPanning = true;
        this._isDragging = false;
        e.preventDefault();
      }
      // Ctrl + left click = pan
      else if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        this._isPanning = true;
        this._isDragging = false;
      }
      // Space held + left click = pan
      else if (e.button === 0 && this._spaceHeld) {
        this._isPanning = true;
        this._isDragging = false;
      }
      // Normal left click = orbit rotate
      else if (e.button === 0) {
        this._isDragging = true;
        this._isPanning = false;
      }
    });

    // ---- Pointer up ----
    window.addEventListener('pointerup', () => {
      this._isDragging = false;
      this._isPanning = false;
    });

    // ---- Pointer move ----
    window.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this._lastMouse.x;
      const dy = e.clientY - this._lastMouse.y;
      this._lastMouse = { x: e.clientX, y: e.clientY };

      if (this._isPanning) {
        // Pan: move orbit target in camera-relative XZ plane
        const panSpeed = 0.01 * this._orbitDist * 0.15;
        const sinA = Math.sin(this._orbitAngle);
        const cosA = Math.cos(this._orbitAngle);
        this._orbitTarget.x -= (cosA * dx + sinA * dy * Math.sin(this._orbitPitch)) * panSpeed;
        this._orbitTarget.z -= (-sinA * dx + cosA * dy * Math.sin(this._orbitPitch)) * panSpeed;
        this._orbitTarget.y -= dy * panSpeed * Math.cos(this._orbitPitch) * -0.5;
        this._orbitTarget.y = Math.max(0, Math.min(20, this._orbitTarget.y));
        // Auto-disable follow when user pans
        if (this._followAgent) {
          this._followAgent = false;
          if (this._onFollowChange) this._onFollowChange(false);
        }
      } else if (this._isDragging) {
        this._orbitAngle -= dx * 0.005;
        this._orbitPitch = Math.max(0.05, Math.min(1.5, this._orbitPitch + dy * 0.005));
      }
    });

    // ---- Scroll wheel zoom (Shift = 3× speed) ----
    canvas.addEventListener('wheel', (e) => {
      const speed = e.shiftKey ? 0.06 : 0.02;
      this._orbitDist = Math.max(3, Math.min(80, this._orbitDist + e.deltaY * speed));
      e.preventDefault();
    }, { passive: false });

    // ---- Double-click to re-focus on agent ----
    canvas.addEventListener('dblclick', () => {
      this._focusOnAgent();
    });

    // ---- Keyboard shortcuts ----
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        this._spaceHeld = true;
        if (document.activeElement === canvas || document.activeElement === document.body) {
          e.preventDefault();
        }
      }
      // Home: reset camera to default view
      if (e.code === 'Home') {
        this._orbitAngle = this._defaultOrbitAngle;
        this._orbitPitch = this._defaultOrbitPitch;
        this._orbitDist = this._defaultOrbitDist;
        this._focusOnAgent();
        e.preventDefault();
      }
      // F: focus/re-center on agent
      if (e.code === 'KeyF' && !e.ctrlKey && !e.altKey) {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
        this._focusOnAgent();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this._spaceHeld = false;
    });

    // Prevent context menu on canvas
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _focusOnAgent() {
    this._orbitTarget.copy(this._agentPos);
    this.setFollowAgent(true);
  }

  _updateCamera() {
    const t = this._orbitTarget;
    this.camera.position.set(
      t.x + this._orbitDist * Math.sin(this._orbitAngle) * Math.cos(this._orbitPitch),
      t.y + this._orbitDist * Math.sin(this._orbitPitch),
      t.z + this._orbitDist * Math.cos(this._orbitAngle) * Math.cos(this._orbitPitch)
    );
    this.camera.lookAt(t);
  }

  /* ============================================================
     BUILD THE ENTIRE ENVIRONMENT
     ============================================================ */
  _buildEnvironment() {
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
    this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.012);

    this._buildLighting();
    this._buildGround();
    this._buildHouseStructure();
    this._buildLivingRoom();
    this._buildKitchen();
    this._buildBedroom();
    this._buildBathroom();
    this._buildOutdoor();
  }

  /* ---- Lighting ---- */
  _buildLighting() {
    const ambient = new THREE.AmbientLight(0xfff5e6, 0.5);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x87CEEB, 0x556633, 0.4);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0dd, 1.2);
    sun.position.set(15, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    this.scene.add(sun);

    // Interior warm light
    const interiorLight = new THREE.PointLight(0xffe4b5, 0.8, 20);
    interiorLight.position.set(0, 4, 0);
    this.scene.add(interiorLight);
  }

  /* ---- Ground ---- */
  _buildGround() {
    // Grass
    const grassGeo = new THREE.PlaneGeometry(80, 80);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x4a8c3f,
      roughness: 0.9,
      metalness: 0.0
    });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Walkway to front door
    const pathGeo = new THREE.PlaneGeometry(2, 8);
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x999088, roughness: 0.8 });
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.01, -11);
    this.scene.add(path);
  }

  /* ============================================================
     HOUSE STRUCTURE
     House is 14x14, from (-7,-7) to (7,7)
     Rooms:
       Living Room: (-7,-7) to (0,0) — front-left
       Kitchen:     (0,-7) to (7,0)  — front-right
       Bedroom:     (-7,0) to (0,7)  — back-left
       Bathroom:    (0,0) to (7,7)   — back-right
     ============================================================ */
  _buildHouseStructure() {
    const wallH = 3.5;
    const wallThick = 0.2;
    const wallColor = 0xf5f0e8;
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.7 });

    // Floor
    const floorGeo = new THREE.PlaneGeometry(14, 14);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xd4a76a, roughness: 0.6 }); // Wood floor
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.02, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // ---- Outer walls ----
    // Front wall (south, z = -7) — with door gap in center
    this._addWall('wall_front_left', { x: -3.75, z: -7, w: 6.5, h: wallH, d: wallThick }, wallMat);
    this._addWall('wall_front_right', { x: 3.75, z: -7, w: 6.5, h: wallH, d: wallThick }, wallMat);
    // Door frame top
    this._addWall('wall_front_top', { x: 0, z: -7, w: 1.2, h: 1.0, d: wallThick, y: wallH - 0.5 }, wallMat);

    // Back wall (north, z = 7)
    this._addWall('wall_back', { x: 0, z: 7, w: 14, h: wallH, d: wallThick }, wallMat);

    // Left wall (west, x = -7)
    this._addWall('wall_left', { x: -7, z: 0, w: wallThick, h: wallH, d: 14 }, wallMat);

    // Right wall (east, x = 7)
    this._addWall('wall_right', { x: 7, z: 0, w: wallThick, h: wallH, d: 14 }, wallMat);

    // ---- Interior walls ----
    // Center wall east-west (divides front/back), gap for hallway
    this._addWall('wall_mid_left', { x: -4.5, z: 0, w: 5, h: wallH, d: wallThick }, wallMat);
    this._addWall('wall_mid_right', { x: 4.5, z: 0, w: 5, h: wallH, d: wallThick }, wallMat);

    // Center wall north-south (divides left/right), gap for passage
    this._addWall('wall_center_front', { x: 0, z: -4.5, w: wallThick, h: wallH, d: 5 }, wallMat);
    this._addWall('wall_center_back', { x: 0, z: 4.5, w: wallThick, h: wallH, d: 5 }, wallMat);

    // Simple flat roof
    const roofGeo = new THREE.PlaneGeometry(14.4, 14.4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8, side: THREE.DoubleSide });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, wallH, 0);
    this.scene.add(roof);

    // Front door
    this._addInteractable('front_door', {
      geo: new THREE.BoxGeometry(1.2, 2.5, 0.1),
      color: 0x6B3A2A,
      pos: { x: 0, y: 1.25, z: -6.95 },
      description: 'The front door of the house',
      type: 'door'
    });
  }

  /* ============================================================
     LIVING ROOM (front-left: x -7 to 0, z -7 to 0)
     ============================================================ */
  _buildLivingRoom() {
    const cx = -3.5, cz = -3.5; // Center of room

    // Sofa — long box
    this._addInteractable('sofa', {
      geo: new THREE.BoxGeometry(3, 0.8, 1),
      color: 0x4a6fa5,
      pos: { x: cx - 1.5, y: 0.4, z: cz - 2.2 },
      description: 'A comfortable blue sofa',
      type: 'furniture'
    });
    // Sofa back
    this._addDecor({ geo: new THREE.BoxGeometry(3, 0.5, 0.15), color: 0x3d5d8a, pos: { x: cx - 1.5, y: 0.85, z: cz - 2.65 } });
    // Sofa armrests
    this._addDecor({ geo: new THREE.BoxGeometry(0.15, 0.5, 1), color: 0x3d5d8a, pos: { x: cx - 3, y: 0.65, z: cz - 2.2 } });
    this._addDecor({ geo: new THREE.BoxGeometry(0.15, 0.5, 1), color: 0x3d5d8a, pos: { x: cx, y: 0.65, z: cz - 2.2 } });

    // Coffee table
    this._addInteractable('coffee_table', {
      geo: new THREE.BoxGeometry(1.5, 0.1, 0.8),
      color: 0x8B6914,
      pos: { x: cx - 1.5, y: 0.4, z: cz - 0.8 },
      description: 'A wooden coffee table with some magazines',
      type: 'furniture'
    });
    // Table legs
    for (const [lx, lz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) {
      this._addDecor({ geo: new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6), color: 0x6B4F1D, pos: { x: cx - 1.5 + lx, y: 0.175, z: cz - 0.8 + lz } });
    }

    // TV on a stand
    this._addInteractable('tv', {
      geo: new THREE.BoxGeometry(2.2, 1.3, 0.08),
      color: 0x111111,
      pos: { x: cx - 1.5, y: 1.5, z: cz + 2.2 },
      description: 'A large flatscreen TV',
      type: 'electronics'
    });
    // TV screen (slightly brighter)
    this._addDecor({ geo: new THREE.BoxGeometry(2, 1.1, 0.02), color: 0x1a2a44, pos: { x: cx - 1.5, y: 1.5, z: cz + 2.17 }, emissive: 0x1a2a44, emissiveIntensity: 0.3 });
    // TV stand
    this._addInteractable('tv_stand', {
      geo: new THREE.BoxGeometry(2.5, 0.6, 0.5),
      color: 0x333333,
      pos: { x: cx - 1.5, y: 0.3, z: cz + 2.3 },
      description: 'A black TV stand with shelves',
      type: 'furniture'
    });

    // Bookshelf against left wall
    this._addInteractable('bookshelf', {
      geo: new THREE.BoxGeometry(0.4, 2.5, 1.5),
      color: 0x8B6914,
      pos: { x: cx - 3.2, y: 1.25, z: cz },
      description: 'A tall wooden bookshelf packed with books',
      type: 'furniture'
    });
    // Books — rows of colored blocks
    const bookColors = [0xcc3333, 0x3366cc, 0x33cc66, 0xcccc33, 0x9933cc];
    for (let shelf = 0; shelf < 4; shelf++) {
      for (let b = 0; b < 3; b++) {
        this._addDecor({
          geo: new THREE.BoxGeometry(0.15, 0.3, 0.12),
          color: bookColors[(shelf * 3 + b) % bookColors.length],
          pos: { x: cx - 3.0, y: 0.4 + shelf * 0.6, z: cz - 0.4 + b * 0.35 }
        });
      }
    }

    // Floor lamp
    this._addInteractable('floor_lamp', {
      geo: new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8),
      color: 0x444444,
      pos: { x: cx + 0.5, y: 0.9, z: cz - 2.2 },
      description: 'A tall floor lamp with warm light',
      type: 'electronics'
    });
    // Lamp shade
    this._addDecor({ geo: new THREE.CylinderGeometry(0.25, 0.15, 0.3, 12), color: 0xfff5e0, pos: { x: cx + 0.5, y: 1.9, z: cz - 2.2 } });
    // Lamp base
    this._addDecor({ geo: new THREE.CylinderGeometry(0.15, 0.15, 0.05, 12), color: 0x444444, pos: { x: cx + 0.5, y: 0.03, z: cz - 2.2 } });

    // Rug
    const rugGeo = new THREE.PlaneGeometry(2.5, 2);
    const rugMat = new THREE.MeshStandardMaterial({ color: 0x8B3A3A, roughness: 0.95 });
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(cx - 1.5, 0.03, cz - 1.5);
    this.scene.add(rug);

    // Picture frame on wall
    this._addInteractable('painting', {
      geo: new THREE.BoxGeometry(1.2, 0.8, 0.05),
      color: 0xDDAA33,
      pos: { x: cx - 1.5, y: 2.2, z: cz - 2.85 },
      description: 'A framed landscape painting',
      type: 'decoration'
    });

    // Remote control on coffee table
    this._addInteractable('remote_control', {
      geo: new THREE.BoxGeometry(0.2, 0.03, 0.08),
      color: 0x222222,
      pos: { x: cx - 1.2, y: 0.47, z: cz - 0.8 },
      description: 'A TV remote control',
      type: 'electronics'
    });
  }

  /* ============================================================
     KITCHEN (front-right: x 0 to 7, z -7 to 0)
     ============================================================ */
  _buildKitchen() {
    const cx = 3.5, cz = -3.5;

    // Kitchen tile floor
    const tileGeo = new THREE.PlaneGeometry(7, 7);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.5 });
    const tile = new THREE.Mesh(tileGeo, tileMat);
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(cx, 0.025, cz);
    tile.receiveShadow = true;
    this.scene.add(tile);

    // Counter along back wall
    this._addInteractable('kitchen_counter', {
      geo: new THREE.BoxGeometry(5, 0.9, 0.7),
      color: 0xd4c5a9,
      pos: { x: cx, y: 0.45, z: cz + 2.8 },
      description: 'A long kitchen counter with granite top',
      type: 'furniture'
    });
    // Counter top
    this._addDecor({ geo: new THREE.BoxGeometry(5, 0.05, 0.7), color: 0x888888, pos: { x: cx, y: 0.92, z: cz + 2.8 } });

    // Stove/Oven
    this._addInteractable('stove', {
      geo: new THREE.BoxGeometry(0.8, 0.9, 0.7),
      color: 0xcccccc,
      pos: { x: cx + 1.5, y: 0.45, z: cz + 2.8 },
      description: 'A stainless steel gas stove with 4 burners',
      type: 'appliance'
    });
    // Burner grates
    for (const [bx, bz] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]]) {
      this._addDecor({ geo: new THREE.TorusGeometry(0.06, 0.01, 6, 12), color: 0x333333, pos: { x: cx + 1.5 + bx, y: 0.93, z: cz + 2.8 + bz }, rotX: Math.PI / 2 });
    }

    // Fridge
    this._addInteractable('fridge', {
      geo: new THREE.BoxGeometry(0.9, 2.2, 0.8),
      color: 0xdcdcdc,
      pos: { x: cx + 2.8, y: 1.1, z: cz + 2.8 },
      description: 'A large stainless steel refrigerator',
      type: 'appliance'
    });
    // Fridge handle
    this._addDecor({ geo: new THREE.BoxGeometry(0.03, 0.6, 0.03), color: 0xaaaaaa, pos: { x: cx + 2.4, y: 1.4, z: cz + 2.4 } });

    // Kitchen sink
    this._addInteractable('kitchen_sink', {
      geo: new THREE.BoxGeometry(0.8, 0.15, 0.5),
      color: 0xaaaaaa,
      pos: { x: cx - 0.5, y: 0.88, z: cz + 2.8 },
      description: 'A kitchen sink with a faucet',
      type: 'appliance'
    });
    // Faucet
    this._addDecor({ geo: new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), color: 0xcccccc, pos: { x: cx - 0.5, y: 1.1, z: cz + 3.0 } });
    this._addDecor({ geo: new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8), color: 0xcccccc, pos: { x: cx - 0.5, y: 1.25, z: cz + 2.92 }, rotX: Math.PI / 2 });

    // Dining table
    this._addInteractable('dining_table', {
      geo: new THREE.BoxGeometry(2, 0.08, 1.2),
      color: 0x8B6914,
      pos: { x: cx, y: 0.75, z: cz - 1.5 },
      description: 'A wooden dining table',
      type: 'furniture'
    });
    // Table legs
    for (const [lx, lz] of [[-0.85, -0.5], [0.85, -0.5], [-0.85, 0.5], [0.85, 0.5]]) {
      this._addDecor({ geo: new THREE.BoxGeometry(0.06, 0.75, 0.06), color: 0x6B4F1D, pos: { x: cx + lx, y: 0.375, z: cz - 1.5 + lz } });
    }

    // Chairs around dining table
    for (let i = 0; i < 4; i++) {
      const positions = [
        { x: cx - 0.6, z: cz - 2.2 }, { x: cx + 0.6, z: cz - 2.2 },
        { x: cx - 0.6, z: cz - 0.8 }, { x: cx + 0.6, z: cz - 0.8 }
      ];
      const p = positions[i];
      this._addInteractable(`dining_chair_${i + 1}`, {
        geo: new THREE.BoxGeometry(0.45, 0.05, 0.45),
        color: 0x8B6914,
        pos: { x: p.x, y: 0.45, z: p.z },
        description: `A wooden dining chair`,
        type: 'furniture'
      });
      // Chair legs
      for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
        this._addDecor({ geo: new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6), color: 0x6B4F1D, pos: { x: p.x + lx, y: 0.225, z: p.z + lz } });
      }
      // Chair back
      const backZ = i < 2 ? -0.22 : 0.22;
      this._addDecor({ geo: new THREE.BoxGeometry(0.4, 0.5, 0.04), color: 0x8B6914, pos: { x: p.x, y: 0.72, z: p.z + backZ } });
    }

    // Plate on table
    this._addInteractable('plate', {
      geo: new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16),
      color: 0xffffff,
      pos: { x: cx, y: 0.8, z: cz - 1.5 },
      description: 'A white ceramic dinner plate',
      type: 'object'
    });

    // Coffee mug
    this._addInteractable('coffee_mug', {
      geo: new THREE.CylinderGeometry(0.05, 0.04, 0.1, 12),
      color: 0xcc6633,
      pos: { x: cx + 0.5, y: 0.84, z: cz - 1.3 },
      description: 'A ceramic coffee mug',
      type: 'object'
    });

    // Microwave on counter
    this._addInteractable('microwave', {
      geo: new THREE.BoxGeometry(0.5, 0.3, 0.35),
      color: 0x333333,
      pos: { x: cx - 1.8, y: 1.1, z: cz + 2.8 },
      description: 'A microwave oven',
      type: 'appliance'
    });

    // Toaster on counter
    this._addInteractable('toaster', {
      geo: new THREE.BoxGeometry(0.2, 0.18, 0.12),
      color: 0xcccccc,
      pos: { x: cx + 0.5, y: 0.98, z: cz + 2.8 },
      description: 'A chrome toaster',
      type: 'appliance'
    });
  }

  /* ============================================================
     BEDROOM (back-left: x -7 to 0, z 0 to 7)
     ============================================================ */
  _buildBedroom() {
    const cx = -3.5, cz = 3.5;

    // Carpet
    const carpetGeo = new THREE.PlaneGeometry(5, 5);
    const carpetMat = new THREE.MeshStandardMaterial({ color: 0x6b7b8d, roughness: 0.95 });
    const carpet = new THREE.Mesh(carpetGeo, carpetMat);
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(cx, 0.025, cz);
    this.scene.add(carpet);

    // Bed frame
    this._addInteractable('bed', {
      geo: new THREE.BoxGeometry(2.2, 0.35, 2.8),
      color: 0x6B4226,
      pos: { x: cx - 1.5, y: 0.25, z: cz + 1.5 },
      description: 'A queen-size bed with pillows and blankets',
      type: 'furniture'
    });
    // Mattress
    this._addDecor({ geo: new THREE.BoxGeometry(2, 0.2, 2.6), color: 0xf5f5f5, pos: { x: cx - 1.5, y: 0.52, z: cz + 1.5 } });
    // Blanket
    this._addDecor({ geo: new THREE.BoxGeometry(2, 0.05, 1.8), color: 0x4a6fa5, pos: { x: cx - 1.5, y: 0.65, z: cz + 1.8 } });
    // Pillows
    this._addDecor({ geo: new THREE.BoxGeometry(0.6, 0.15, 0.4), color: 0xffffff, pos: { x: cx - 1.9, y: 0.68, z: cz + 0.35 } });
    this._addDecor({ geo: new THREE.BoxGeometry(0.6, 0.15, 0.4), color: 0xffffff, pos: { x: cx - 1.1, y: 0.68, z: cz + 0.35 } });
    // Headboard
    this._addDecor({ geo: new THREE.BoxGeometry(2.2, 1, 0.1), color: 0x5C3317, pos: { x: cx - 1.5, y: 0.9, z: cz + 2.9 } });

    // Nightstand
    this._addInteractable('nightstand', {
      geo: new THREE.BoxGeometry(0.5, 0.5, 0.4),
      color: 0x6B4226,
      pos: { x: cx - 0.1, y: 0.25, z: cz + 2.3 },
      description: 'A bedside nightstand with a drawer',
      type: 'furniture'
    });

    // Alarm clock on nightstand
    this._addInteractable('alarm_clock', {
      geo: new THREE.BoxGeometry(0.12, 0.08, 0.06),
      color: 0x222222,
      pos: { x: cx - 0.1, y: 0.54, z: cz + 2.3 },
      description: 'A digital alarm clock showing 7:00 AM',
      type: 'electronics'
    });

    // Desk lamp on nightstand
    this._addInteractable('desk_lamp', {
      geo: new THREE.CylinderGeometry(0.08, 0.1, 0.02, 12),
      color: 0x444444,
      pos: { x: cx + 0.1, y: 0.52, z: cz + 2.5 },
      description: 'A small desk lamp',
      type: 'electronics'
    });
    this._addDecor({ geo: new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8), color: 0x444444, pos: { x: cx + 0.1, y: 0.65, z: cz + 2.5 } });
    this._addDecor({ geo: new THREE.ConeGeometry(0.1, 0.12, 12), color: 0xfff5e0, pos: { x: cx + 0.1, y: 0.82, z: cz + 2.5 } });

    // Wardrobe/Closet
    this._addInteractable('wardrobe', {
      geo: new THREE.BoxGeometry(1.6, 2.5, 0.7),
      color: 0x8B6914,
      pos: { x: cx + 0.8, y: 1.25, z: cz + 2.8 },
      description: 'A large wooden wardrobe with double doors',
      type: 'furniture'
    });
    // Wardrobe handles
    this._addDecor({ geo: new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8), color: 0xccaa44, pos: { x: cx + 0.55, y: 1.3, z: cz + 2.44 }, rotX: Math.PI / 2 });
    this._addDecor({ geo: new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8), color: 0xccaa44, pos: { x: cx + 1.05, y: 1.3, z: cz + 2.44 }, rotX: Math.PI / 2 });

    // Desk
    this._addInteractable('desk', {
      geo: new THREE.BoxGeometry(1.4, 0.06, 0.7),
      color: 0x8B6914,
      pos: { x: cx + 0.8, y: 0.75, z: cz - 1.5 },
      description: 'A wooden study desk',
      type: 'furniture'
    });
    // Desk legs
    for (const [lx, lz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) {
      this._addDecor({ geo: new THREE.BoxGeometry(0.05, 0.75, 0.05), color: 0x6B4F1D, pos: { x: cx + 0.8 + lx, y: 0.375, z: cz - 1.5 + lz } });
    }

    // Laptop on desk
    this._addInteractable('laptop', {
      geo: new THREE.BoxGeometry(0.35, 0.02, 0.25),
      color: 0x555555,
      pos: { x: cx + 0.8, y: 0.79, z: cz - 1.5 },
      description: 'A silver laptop computer',
      type: 'electronics'
    });
    // Laptop screen
    this._addDecor({
      geo: new THREE.BoxGeometry(0.33, 0.22, 0.01),
      color: 0x222244,
      pos: { x: cx + 0.8, y: 0.91, z: cz - 1.63 },
      rotX: -0.1,
      emissive: 0x222244,
      emissiveIntensity: 0.4
    });

    // Desk chair
    this._addInteractable('desk_chair', {
      geo: new THREE.CylinderGeometry(0.22, 0.22, 0.05, 12),
      color: 0x333333,
      pos: { x: cx + 0.8, y: 0.5, z: cz - 0.7 },
      description: 'A swivel desk chair',
      type: 'furniture'
    });
    this._addDecor({ geo: new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), color: 0x444444, pos: { x: cx + 0.8, y: 0.25, z: cz - 0.7 } });

    // Phone on nightstand
    this._addInteractable('phone', {
      geo: new THREE.BoxGeometry(0.08, 0.01, 0.16),
      color: 0x111111,
      pos: { x: cx - 0.25, y: 0.52, z: cz + 2.1 },
      description: 'A smartphone',
      type: 'electronics'
    });

    // Wall poster
    this._addInteractable('poster', {
      geo: new THREE.BoxGeometry(1, 1.4, 0.02),
      color: 0x2244aa,
      pos: { x: cx - 3.2, y: 2, z: cz },
      description: 'A colorful poster on the wall',
      type: 'decoration'
    });
  }

  /* ============================================================
     BATHROOM (back-right: x 0 to 7, z 0 to 7)
     ============================================================ */
  _buildBathroom() {
    const cx = 3.5, cz = 3.5;

    // Tile floor
    const tileGeo = new THREE.PlaneGeometry(7, 7);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0xdde8ee, roughness: 0.3 });
    const tile = new THREE.Mesh(tileGeo, tileMat);
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(cx, 0.025, cz);
    this.scene.add(tile);

    // Bathtub
    this._addInteractable('bathtub', {
      geo: new THREE.BoxGeometry(1.8, 0.6, 0.8),
      color: 0xf0f0f0,
      pos: { x: cx + 2, y: 0.3, z: cz + 2.5 },
      description: 'A white porcelain bathtub with chrome faucets',
      type: 'fixture'
    });
    // Inside of bathtub (darker)
    this._addDecor({ geo: new THREE.BoxGeometry(1.5, 0.1, 0.5), color: 0xe0e8ee, pos: { x: cx + 2, y: 0.55, z: cz + 2.5 } });

    // Toilet
    this._addInteractable('toilet', {
      geo: new THREE.BoxGeometry(0.45, 0.45, 0.6),
      color: 0xf8f8f8,
      pos: { x: cx + 2.5, y: 0.225, z: cz - 0.5 },
      description: 'A white ceramic toilet',
      type: 'fixture'
    });
    // Tank
    this._addDecor({ geo: new THREE.BoxGeometry(0.4, 0.5, 0.2), color: 0xf0f0f0, pos: { x: cx + 2.5, y: 0.5, z: cz - 0.15 } });
    // Seat
    this._addDecor({ geo: new THREE.TorusGeometry(0.15, 0.04, 8, 16), color: 0xf0f0f0, pos: { x: cx + 2.5, y: 0.48, z: cz - 0.6 }, rotX: Math.PI / 2 });

    // Bathroom sink / vanity
    this._addInteractable('bathroom_sink', {
      geo: new THREE.BoxGeometry(0.8, 0.8, 0.5),
      color: 0xe8e0d0,
      pos: { x: cx + 0.5, y: 0.4, z: cz + 2.8 },
      description: 'A bathroom vanity with a sink and mirror',
      type: 'fixture'
    });
    // Sink basin
    this._addDecor({ geo: new THREE.CylinderGeometry(0.2, 0.15, 0.1, 16), color: 0xffffff, pos: { x: cx + 0.5, y: 0.82, z: cz + 2.7 } });
    // Faucet
    this._addDecor({ geo: new THREE.CylinderGeometry(0.015, 0.015, 0.2, 8), color: 0xcccccc, pos: { x: cx + 0.5, y: 0.95, z: cz + 2.95 } });

    // Mirror
    this._addInteractable('mirror', {
      geo: new THREE.BoxGeometry(0.7, 1, 0.04),
      color: 0xbbccdd,
      pos: { x: cx + 0.5, y: 2, z: cz + 2.95 },
      description: 'A bathroom mirror',
      type: 'fixture'
    });

    // Towel rack
    this._addInteractable('towel', {
      geo: new THREE.BoxGeometry(0.6, 0.8, 0.04),
      color: 0x4488cc,
      pos: { x: cx + 0.5, y: 1.5, z: cz - 0.9 },
      description: 'A blue towel hanging on a rack',
      type: 'object'
    });

    // Shower head (on wall)
    this._addDecor({ geo: new THREE.CylinderGeometry(0.1, 0.08, 0.04, 12), color: 0xcccccc, pos: { x: cx + 2, y: 2.5, z: cz + 2.9 } });
    this._addDecor({ geo: new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), color: 0xcccccc, pos: { x: cx + 2, y: 2.8, z: cz + 2.9 }, rotX: 0.3 });

    // Soap dispenser
    this._addInteractable('soap', {
      geo: new THREE.CylinderGeometry(0.04, 0.04, 0.12, 8),
      color: 0xffcc88,
      pos: { x: cx + 0.8, y: 0.86, z: cz + 2.7 },
      description: 'A soap dispenser',
      type: 'object'
    });

    // Toilet paper holder
    this._addInteractable('toilet_paper', {
      geo: new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12),
      color: 0xffffff,
      pos: { x: cx + 2.9, y: 0.6, z: cz - 0.7 },
      description: 'A roll of toilet paper',
      type: 'object'
    });
  }

  /* ============================================================
     OUTDOOR AREA
     ============================================================ */
  _buildOutdoor() {
    // Trees
    this._addTree('tree_1', { x: -12, z: -5 });
    this._addTree('tree_2', { x: -10, z: 8 });
    this._addTree('tree_3', { x: 12, z: 10 });
    this._addTree('tree_4', { x: 15, z: -8 });
    this._addTree('tree_5', { x: -5, z: -14 });

    // Bushes
    this._addBush({ x: -8, z: -8 });
    this._addBush({ x: 8, z: -8 });
    this._addBush({ x: -3, z: -8 });
    this._addBush({ x: 3, z: -8 });

    // Fence along front
    for (let fx = -15; fx <= 15; fx += 1) {
      if (Math.abs(fx) < 2 && true) continue; // Gate gap
      this._addDecor({ geo: new THREE.BoxGeometry(0.08, 0.8, 0.08), color: 0xf5f0e8, pos: { x: fx, y: 0.4, z: -15 } });
    }
    // Fence rails
    this._addDecor({ geo: new THREE.BoxGeometry(30, 0.05, 0.05), color: 0xf5f0e8, pos: { x: 0, y: 0.6, z: -15 } });
    this._addDecor({ geo: new THREE.BoxGeometry(30, 0.05, 0.05), color: 0xf5f0e8, pos: { x: 0, y: 0.25, z: -15 } });

    // Mailbox
    this._addInteractable('mailbox', {
      geo: new THREE.BoxGeometry(0.3, 0.25, 0.4),
      color: 0x3355cc,
      pos: { x: 1.5, y: 1, z: -14 },
      description: 'A blue mailbox — might have mail inside',
      type: 'object'
    });
    // Mailbox post
    this._addDecor({ geo: new THREE.CylinderGeometry(0.04, 0.04, 1, 8), color: 0x6B4226, pos: { x: 1.5, y: 0.5, z: -14 } });

    // Car in driveway
    this._addCar('car', { x: 5, z: -12 });

    // Outdoor bench
    this._addInteractable('bench', {
      geo: new THREE.BoxGeometry(1.8, 0.08, 0.5),
      color: 0x6B4226,
      pos: { x: -10, y: 0.5, z: -2 },
      description: 'A wooden park bench',
      type: 'furniture'
    });
    // Bench legs
    this._addDecor({ geo: new THREE.BoxGeometry(0.08, 0.5, 0.5), color: 0x555555, pos: { x: -10.7, y: 0.25, z: -2 } });
    this._addDecor({ geo: new THREE.BoxGeometry(0.08, 0.5, 0.5), color: 0x555555, pos: { x: -9.3, y: 0.25, z: -2 } });
    // Bench back
    this._addDecor({ geo: new THREE.BoxGeometry(1.8, 0.6, 0.05), color: 0x6B4226, pos: { x: -10, y: 0.85, z: -2.22 } });

    // Trash can outside
    this._addInteractable('trash_can', {
      geo: new THREE.CylinderGeometry(0.3, 0.25, 0.8, 12),
      color: 0x444444,
      pos: { x: -8.5, y: 0.4, z: -7.5 },
      description: 'An outdoor trash can',
      type: 'object'
    });

    // Garden flowers
    for (let i = 0; i < 6; i++) {
      const flowerColors = [0xff4466, 0xffaa33, 0xff66cc, 0xffff44, 0xff3333, 0xcc44ff];
      this._addDecor({
        geo: new THREE.SphereGeometry(0.12, 8, 8),
        color: flowerColors[i],
        pos: { x: -7.5 + i * 0.5, y: 0.25, z: -7.8 }
      });
      this._addDecor({
        geo: new THREE.CylinderGeometry(0.015, 0.015, 0.25, 6),
        color: 0x33aa33,
        pos: { x: -7.5 + i * 0.5, y: 0.12, z: -7.8 }
      });
    }

    // Street light
    this._addDecor({ geo: new THREE.CylinderGeometry(0.06, 0.06, 4, 8), color: 0x444444, pos: { x: -2, y: 2, z: -16 } });
    this._addDecor({ geo: new THREE.SphereGeometry(0.2, 8, 8), color: 0xffffcc, pos: { x: -2, y: 4.1, z: -16 }, emissive: 0xffffcc, emissiveIntensity: 0.5 });
  }

  /* ---- Helper: Tree ---- */
  _addTree(id, pos) {
    // Trunk
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.3, 2, 8),
      new THREE.MeshStandardMaterial({ color: 0x6B4226, roughness: 0.9 })
    );
    trunk.position.set(pos.x, 1, pos.z);
    trunk.castShadow = true;
    this.scene.add(trunk);

    // Canopy
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x337733, roughness: 0.8 })
    );
    canopy.position.set(pos.x, 3, pos.z);
    canopy.castShadow = true;
    this.scene.add(canopy);

    this.objects.set(id, { mesh: trunk, type: 'tree', id, description: 'A leafy tree', interactable: true });
  }

  /* ---- Helper: Bush ---- */
  _addBush(pos) {
    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2d6b2d, roughness: 0.9 })
    );
    bush.position.set(pos.x, 0.4, pos.z);
    bush.castShadow = true;
    this.scene.add(bush);
  }

  /* ---- Helper: Car ---- */
  _addCar(id, pos) {
    const group = new THREE.Group();
    group.position.set(pos.x, 0, pos.z);

    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.6, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.3, metalness: 0.6 })
    );
    body.position.y = 0.5;
    body.castShadow = true;
    group.add(body);

    // Cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.5, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.3, metalness: 0.6 })
    );
    cabin.position.set(-0.1, 1.05, 0);
    cabin.castShadow = true;
    group.add(cabin);

    // Windows
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x88bbff, roughness: 0.1, metalness: 0.8 });
    const fw = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.35, 0.9), windowMat);
    fw.position.set(0.5, 1.0, 0);
    group.add(fw);
    const bw = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.35, 0.9), windowMat);
    bw.position.set(-0.7, 1.0, 0);
    group.add(bw);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    for (const [wx, wz] of [[0.65, 0.65], [0.65, -0.65], [-0.65, 0.65], [-0.65, -0.65]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.2, wz);
      group.add(w);
    }

    // Headlights
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
    const hl1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), hlMat);
    hl1.position.set(1, 0.5, 0.4);
    group.add(hl1);
    const hl2 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), hlMat);
    hl2.position.set(1, 0.5, -0.4);
    group.add(hl2);

    this.scene.add(group);
    this.objects.set(id, { mesh: body, group, type: 'vehicle', id, description: 'A red sedan parked in the driveway', interactable: true });
  }

  /* ---- Helper: Wall (structural, not interactable) ---- */
  _addWall(id, cfg, mat) {
    const geo = new THREE.BoxGeometry(cfg.w, cfg.h, cfg.d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cfg.x, cfg.y || cfg.h / 2, cfg.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.objects.set(id, { mesh, type: 'wall', id, description: 'A wall', interactable: false });
  }

  /* ---- Helper: Interactable object ---- */
  _addInteractable(id, cfg) {
    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      roughness: cfg.roughness ?? 0.5,
      metalness: cfg.metalness ?? 0.1
    });
    if (cfg.emissive) {
      mat.emissive = new THREE.Color(cfg.emissive);
      mat.emissiveIntensity = cfg.emissiveIntensity ?? 0.1;
    }
    const mesh = new THREE.Mesh(cfg.geo, mat);
    mesh.position.set(cfg.pos.x, cfg.pos.y, cfg.pos.z);
    if (cfg.rotX) mesh.rotation.x = cfg.rotX;
    if (cfg.rotY) mesh.rotation.y = cfg.rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.objects.set(id, {
      mesh, type: cfg.type || 'object', id,
      description: cfg.description,
      interactable: true
    });
  }

  /* ---- Helper: Decorative (visual only, not in object list) ---- */
  _addDecor(cfg) {
    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      roughness: cfg.roughness ?? 0.5,
      metalness: cfg.metalness ?? 0.1
    });
    if (cfg.emissive) {
      mat.emissive = new THREE.Color(cfg.emissive);
      mat.emissiveIntensity = cfg.emissiveIntensity ?? 0.1;
    }
    const mesh = new THREE.Mesh(cfg.geo, mat);
    mesh.position.set(cfg.pos.x, cfg.pos.y, cfg.pos.z);
    if (cfg.rotX) mesh.rotation.x = cfg.rotX;
    if (cfg.rotY) mesh.rotation.y = cfg.rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /* ---- Public API ---- */
  getObjectsData() {
    const result = [];
    for (const [id, obj] of this.objects) {
      if (obj.type === 'wall') continue; // Skip walls from scan
      result.push({
        id,
        type: obj.type,
        description: obj.description,
        interactable: obj.interactable,
        position: {
          x: parseFloat(obj.mesh.position.x.toFixed(2)),
          z: parseFloat(obj.mesh.position.z.toFixed(2))
        }
      });
    }
    return result;
  }

  getObject(id) {
    return this.objects.get(id) || null;
  }

  followAgent(agentPos) {
    this._agentPos.copy(agentPos);
    if (this._followAgent) {
      this._orbitTarget.lerp(agentPos, 0.05);
    }
  }

  setFollowAgent(enabled) {
    this._followAgent = enabled;
    if (enabled) {
      this._orbitTarget.copy(this._agentPos);
    }
    if (this._onFollowChange) this._onFollowChange(enabled);
  }

  toggleFollowAgent() {
    this.setFollowAgent(!this._followAgent);
    return this._followAgent;
  }

  get isFollowing() {
    return this._followAgent;
  }

  resize() {
    const panel = this.renderer.domElement.parentElement;
    if (!panel) return;
    const w = panel.clientWidth;
    const h = panel.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this._updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
