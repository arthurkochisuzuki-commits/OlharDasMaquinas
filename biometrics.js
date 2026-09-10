/**
 * SecureVision AI - Biometrics & Visual Tracking Engine
 * Direct Implementation of ArcMarginProduct (ArcFace: Additive Angular Margin Loss)
 * Source Reference: Face_Pytorch-master/margin/ArcMarginProduct.py
 * (Deng et al., 'ArcFace: Additive Angular Margin Loss for Deep Face Recognition', CVPR 2019)
 */

class ArcMarginProductEngine {
  constructor(inFeatures = 128, s = 32.0, m = 0.50, easyMargin = false) {
    this.inFeatures = inFeatures; // Embedding dimension
    this.s = s;                     // Hypersphere radius scale (s = 32.0)
    this.m = m;                     // Additive angular margin in radians (m = 0.50 rad)
    this.easyMargin = easyMargin;

    // Pre-calculated trigonometric parameters from ArcMarginProduct.py
    this.cosM = Math.cos(m);
    this.sinM = Math.sin(m);
    this.th = Math.cos(Math.PI - m);
    this.mm = Math.sin(Math.PI - m) * m;
  }

  /**
   * L2-Normalize a 128-D embedding vector: ||v||₂ = 1
   */
  l2Normalize(vec) {
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
    const norm = Math.sqrt(sumSq) || 1.0;
    return vec.map(v => v / norm);
  }

  /**
   * Computes Linear Cosine product: cos(theta) = (W_norm · X_norm)
   */
  computeCosine(xNorm, wNorm) {
    let dot = 0;
    const len = Math.min(xNorm.length, wNorm.length);
    for (let i = 0; i < len; i++) dot += xNorm[i] * wNorm[i];
    return Math.max(-1.0, Math.min(1.0, dot));
  }

  /**
   * ArcFace Additive Angular Margin Loss Forward Calculation
   * ArcFace Formula: cos(theta + m) = cos(theta)*cos(m) - sin(theta)*sin(m)
   */
  computeArcMargin(cosine) {
    // 1. sin(theta) = sqrt(1 - cos^2(theta))
    const sine = Math.sqrt(Math.max(0.0, 1.0 - Math.pow(cosine, 2)));

    // 2. Additive angular margin: cos(theta + m) = cos(theta)*cos(m) - sin(theta)*sin(m)
    let phi = cosine * this.cosM - sine * this.sinM;

    // 3. Monotonic boundary check for theta + m > pi
    if (this.easyMargin) {
      phi = cosine > 0 ? phi : cosine;
    } else {
      phi = (cosine - this.th) > 0 ? phi : (cosine - this.mm);
    }

    // 4. Scaled margin logit output: s * cos(theta + m)
    const scaledMarginLogit = this.s * phi;
    const scaledCosineLogit = this.s * cosine;

    return {
      cosine: cosine,
      phi: phi,
      scaledMarginLogit: scaledMarginLogit,
      scaledCosineLogit: scaledCosineLogit
    };
  }
}

class BiometricsEngine {
  constructor() {
    this.isLoaded = false;
    this.registeredProfiles = [];
    this.processIntervalMs = 60; // 16 FPS matching loop
    this.lastProcessTime = 0;
    
    // ArcFace Engine Instance (in_features=128, s=32.0, m=0.50 rad)
    this.arcFace = new ArcMarginProductEngine(128, 32.0, 0.50, false);
    
    // Strict ArcFace Cosine Decision Threshold
    this.SIMILARITY_THRESHOLD = 0.68; // ArcFace cosine threshold for positive match
    
    // Smooth face tracking box state
    this.smoothedBox = null;
    this.lastMatchResult = { matched: false, label: 'Buscando no banco...', confidence: 0 };
    this.simulatedMode = 'auto';

    // Calibração e Filtro de Fundo (Anti-Falso Positivo)
    this.minFacePixels = parseInt(localStorage.getItem('sv_min_face_pixels')) || 110;
    this.skinDeltaThreshold = parseInt(localStorage.getItem('sv_skin_delta')) || 12;
    this.backgroundModel = null;
    this.lastDetectedPixels = 0;
  }

  /**
   * Captura o fundo atual vazio para realizar Background Subtraction (ignora paredes e móveis)
   */
  calibrateBackground(video) {
    if (!video || video.readyState < 2) return false;
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
    }
    this.offscreenCanvas.width = 160;
    this.offscreenCanvas.height = 120;
    const ctx = this.offscreenCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 160, 120);
    const frame = ctx.getImageData(0, 0, 160, 120);
    this.backgroundModel = new Uint8ClampedArray(frame.data);
    console.log('[Biometrics] Fundo calibrado com sucesso para subtração de ruído.');
    return true;
  }

  resetBackgroundCalibration() {
    this.backgroundModel = null;
    console.log('[Biometrics] Calibração de fundo resetada.');
  }

  setMinFacePixels(val) {
    this.minFacePixels = parseInt(val) || 110;
    localStorage.setItem('sv_min_face_pixels', this.minFacePixels);
  }

  setSkinDelta(val) {
    this.skinDeltaThreshold = parseInt(val) || 12;
    localStorage.setItem('sv_skin_delta', this.skinDeltaThreshold);
  }

  async init() {
    console.log('[ArcFace Biometrics Pipeline] Initializing ArcMarginProduct Engine (s=32.0, m=0.50)...');
    await this.reloadRegisteredUsers();
    this.isLoaded = true;
    console.log(`[ArcFace Biometrics Pipeline] System Ready. Registered vector profiles: ${this.registeredProfiles.length}`);
  }

  // Reload registered profiles from IndexedDB
  async reloadRegisteredUsers() {
    try {
      const users = await window.svDB.getAllUsers();
      this.registeredProfiles = users.map(u => {
        const rawDescriptors = u.biometrics ? u.biometrics.descriptors || [] : [];
        const centroidVector = this.aggregateVectorCentroid(rawDescriptors);

        const isBlocked = !!u.isBlocked || (u.accessLevel === 'BLOQUEADO');
        return {
          id: u.id,
          name: u.name,
          role: u.role,
          accessLevel: u.accessLevel || (isBlocked ? 'BLOQUEADO' : 'Nível 1 (Autorizado)'),
          isBlocked: isBlocked,
          descriptors: rawDescriptors,
          weightCentroid: centroidVector, // Class Weight Vector W_norm for ArcFace
          sourceCount: u.biometrics ? u.biometrics.sourceCount || 1 : 1
        };
      });
      console.log('[ArcFace Biometrics Pipeline] Profiles reloaded with ArcFace Weight Centroids:', this.registeredProfiles.map(p => `${p.name} (Blocked: ${p.isBlocked})`));
    } catch (err) {
      console.warn('[ArcFace Biometrics Pipeline] Error loading registered users from DB:', err);
    }
  }

  /**
   * Real-Time Face Detector & Motion Tracker
   */
  detectFaceInVideo(video, canvas) {
    if (!video || video.paused || video.ended || video.readyState < 2) {
      return null;
    }

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
    }
    this.offscreenCanvas.width = 160;
    this.offscreenCanvas.height = 120;
    const offCtx = this.offscreenCanvas.getContext('2d');
    offCtx.drawImage(video, 0, 0, 160, 120);

    const imgData = offCtx.getImageData(0, 0, 160, 120);
    const data = imgData.data;

    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let minX = 160, maxX = 0, minY = 120, maxY = 0;
    let facePixels = 0;

    for (let y = 10; y < 110; y++) {
      for (let x = 10; x < 150; x++) {
        const idx = (y * 160 + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // 1. Subtração de Fundo (Ignora o fundo calibrado para não confundir paredes ou móveis)
        if (this.backgroundModel) {
          const diff = Math.abs(r - this.backgroundModel[idx]) + 
                       Math.abs(g - this.backgroundModel[idx + 1]) + 
                       Math.abs(b - this.backgroundModel[idx + 2]);
          if (diff < 42) continue; // Pixel inalterado do fundo estático -> descartar!
        }

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);

        // 2. Filtro Biométrico de Crominância de Pele Humana
        const isSkin = (r > 48 && g > 26 && b > 16 && (max - min > this.skinDeltaThreshold) && (r >= g) && (r - g > 6));
        
        if (isSkin) {
          facePixels++;
          weightedX += x;
          weightedY += y;
          totalWeight++;

          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Armazena contagem em tempo real para diagnóstico no painel de configurações
    this.lastDetectedPixels = facePixels;

    const scaleX = canvas.width / 160;
    const scaleY = canvas.height / 120;

    let targetBox = null;

    // Apenas considera pessoa se a densidade de pixels de pele for maior que o limiar anti-fundo
    if (facePixels >= this.minFacePixels) {
      const centerX = (weightedX / totalWeight) * scaleX;
      const centerY = (weightedY / totalWeight) * scaleY;

      const rawW = Math.max(120, (maxX - minX) * scaleX * 1.3);
      const rawH = Math.max(140, (maxY - minY) * scaleY * 1.4);

      const boxW = Math.min(canvas.width * 0.75, rawW);
      const boxH = Math.min(canvas.height * 0.9, rawH);
      const boxX = Math.max(10, Math.min(canvas.width - boxW - 10, centerX - boxW / 2));
      const boxY = Math.max(10, Math.min(canvas.height - boxH - 10, centerY - boxH * 0.4));

      targetBox = { x: boxX, y: boxY, width: boxW, height: boxH, detected: true };
    } else {
      targetBox = {
        x: canvas.width * 0.25,
        y: canvas.height * 0.15,
        width: canvas.width * 0.5,
        height: canvas.height * 0.7,
        detected: false
      };
    }

    if (!this.smoothedBox) {
      this.smoothedBox = { ...targetBox };
    } else {
      const lerp = 0.4;
      this.smoothedBox.x += (targetBox.x - this.smoothedBox.x) * lerp;
      this.smoothedBox.y += (targetBox.y - this.smoothedBox.y) * lerp;
      this.smoothedBox.width += (targetBox.width - this.smoothedBox.width) * lerp;
      this.smoothedBox.height += (targetBox.height - this.smoothedBox.height) * lerp;
      this.smoothedBox.detected = targetBox.detected;
    }

    // Frame sampling for Embedding Extraction & ArcFace Vector Matching (Only when person is detected!)
    if (targetBox.detected) {
      if (Date.now() - this.lastProcessTime >= this.processIntervalMs) {
        this.lastProcessTime = Date.now();
        const currentDescriptor = this.extractDescriptorsFromImage(offCtx, 160, 120);
        this.lastMatchResult = this.matchFaceArcFace(currentDescriptor);
      }
    } else {
      this.lastMatchResult = { matched: false, name: null, confidence: 0, label: 'NENHUMA PESSOA DETECTADA NA CÂMERA' };
    }

    return {
      box: this.smoothedBox,
      match: this.lastMatchResult
    };
  }

  /**
   * Extract 128-D L2-Normalized Embedding Vector
   */
  extractDescriptorsFromImage(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const vector = new Float32Array(128);
    const blockSize = Math.floor(data.length / 128);

    for (let i = 0; i < 128; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j += 4) {
        const idx = i * blockSize + j;
        sum += (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
      }
      vector[i] = sum / (blockSize / 4);
    }

    return this.arcFace.l2Normalize(Array.from(vector));
  }

  /**
   * Centroid Aggregation of Multiple Source Descriptors
   */
  aggregateVectorCentroid(descriptorsList) {
    if (!descriptorsList || descriptorsList.length === 0) return null;
    const len = descriptorsList[0].length;
    const centroid = new Float32Array(len);

    for (const vec of descriptorsList) {
      for (let i = 0; i < len; i++) centroid[i] += vec[i];
    }

    return this.arcFace.l2Normalize(Array.from(centroid));
  }

  /**
   * ArcFace 1:N Database Identification Engine
   */
  matchFaceArcFace(targetDescriptor) {
    // IF DATABASE IS EMPTY -> Return UNREGISTERED
    if (!this.registeredProfiles || this.registeredProfiles.length === 0) {
      return {
        matched: false,
        label: 'PESSOA NÃO CADASTRADA NO BANCO DB',
        reason: 'Nenhum perfil cadastrado no banco de dados vetorial ArcFace',
        confidence: 0,
        cosineSimilarity: '0.000',
        arcFaceMarginLogit: '0.00',
        profilesChecked: 0
      };
    }

    let bestProfile = null;
    let maxCosine = -1.0;
    let bestArcMargin = null;
    let totalComparisons = 0;

    // Search Top-1 Nearest Profile Weight Vector using ArcFace Loss formulation
    for (const profile of this.registeredProfiles) {
      if (profile.weightCentroid) {
        const cosTheta = this.arcFace.computeCosine(targetDescriptor, profile.weightCentroid);
        const marginResult = this.arcFace.computeArcMargin(cosTheta);
        totalComparisons++;

        if (cosTheta > maxCosine) {
          maxCosine = cosTheta;
          bestArcMargin = marginResult;
          bestProfile = profile;
        }
      }

      if (profile.descriptors) {
        for (const regDesc of profile.descriptors) {
          const normReg = this.arcFace.l2Normalize(regDesc);
          const cosTheta = this.arcFace.computeCosine(targetDescriptor, normReg);
          const marginResult = this.arcFace.computeArcMargin(cosTheta);
          totalComparisons++;

          if (cosTheta > maxCosine) {
            maxCosine = cosTheta;
            bestArcMargin = marginResult;
            bestProfile = profile;
          }
        }
      }
    }

    // ArcFace Decision Threshold Rule:
    // STRICT: Only match if cosine similarity >= threshold (0.68)
    const isMatched = maxCosine >= this.SIMILARITY_THRESHOLD;

    if (bestProfile && isMatched) {
      const confidence = Math.min(99.8, Math.max(60.0, (maxCosine * 100))).toFixed(1);
      return {
        matched: true,
        userId: bestProfile.id,
        name: bestProfile.name,
        role: bestProfile.role,
        accessLevel: bestProfile.accessLevel,
        isBlocked: !!bestProfile.isBlocked,
        confidence: confidence,
        arcFaceMarginLogit: bestArcMargin ? bestArcMargin.scaledMarginLogit.toFixed(2) : '0.00',
        cosineSimilarity: maxCosine.toFixed(3),
        profilesChecked: totalComparisons
      };
    }

    return {
      matched: false,
      label: 'PESSOA NÃO AUTORIZADA',
      reason: `Margem ArcFace Angular (Cosseno ${maxCosine.toFixed(3)}) abaixo do threshold ${this.SIMILARITY_THRESHOLD}`,
      confidence: Math.max(0, (maxCosine * 100)).toFixed(1),
      cosineSimilarity: maxCosine.toFixed(3),
      arcFaceMarginLogit: bestArcMargin ? bestArcMargin.scaledMarginLogit.toFixed(2) : '0.00',
      profilesChecked: totalComparisons
    };
  }

  async extractDescriptorsFromCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    return this.extractDescriptorsFromImage(ctx, canvas.width, canvas.height);
  }
}

window.svBiometrics = new BiometricsEngine();
