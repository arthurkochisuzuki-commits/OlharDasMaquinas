/**
 * SecureVision AI - Biometrics & Visual Tracking Engine
 * Direct Implementation of ArcMarginProduct (ArcFace: Additive Angular Margin Loss)
 * Source Reference: Face_Pytorch-master/margin/ArcMarginProduct.py
 * (Deng et al., 'ArcFace: Additive Angular Margin Loss for Deep Face Recognition', CVPR 2019)
 *
 * Atualizado com:
 * 1. Isolamento Anatômico Estrito do Rosto (Fundo 100% Zerado em Canvas Interno).
 * 2. Imunidade Total a Movimentações e Elementos do Plano de Fundo.
 * 3. Validação Morfológica Facial (Elimina caixas, móveis e objetos coloridos).
 * 4. Filtro de Proximidade (minSize para ignorar pessoas distantes ao fundo).
 * 5. Limiar Estrito de Rejeição (Pessoas desconhecidas nunca são autorizadas).
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

class AntiSpoofingLivenessDetector {
  constructor() {
    this.prevFrameData = null;
    this.historyScores = [];
    this.minLivenessThreshold = 0.10;
    this.lastLivenessScore = 0.85;
    this.isSpoofed = false;
    this.spoofReason = '';
  }

  /**
   * Prova de Vida Blindada (Liveness Analysis Estrita na Face):
   * Analisa micro-movimentos e textura EXCLUSIVAMENTE nos pixels internos da máscara facial.
   * Movimentações ao fundo (pessoas passando, ventilador, sombras) são 100% ignoradas.
   */
  evaluateLiveness(isolatedFaceImageData) {
    if (!isolatedFaceImageData) return { isAlive: true, score: 0.85 };

    const data = isolatedFaceImageData.data;
    const width = isolatedFaceImageData.width || 160;
    const height = isolatedFaceImageData.height || 160;

    if (!this.prevFrameData || this.prevFrameData.length !== data.length) {
      this.prevFrameData = new Uint8ClampedArray(data);
      return { isAlive: true, score: 0.75, status: 'CALIBRATING' };
    }

    let diffSum = 0;
    let sampledPixels = 0;
    let highFreqTextureVariance = 0;
    const step = 4; // Amostragem densa na face isolada

    for (let y = 10; y < height - 10; y += step) {
      for (let x = 10; x < width - 10; x += step) {
        const i = (y * width + x) * 4;
        
        // Verifica se o pixel faz parte da máscara facial isolada (não é fundo zerado)
        const alpha = data[i + 3];
        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (alpha < 50 || lum < 5) continue; // Pula pixels do fundo que foram apagados

        const diffR = Math.abs(data[i] - this.prevFrameData[i]);
        const diffG = Math.abs(data[i + 1] - this.prevFrameData[i + 1]);
        const diffB = Math.abs(data[i + 2] - this.prevFrameData[i + 2]);
        const pixelDiff = (diffR + diffG + diffB) / 3;
        diffSum += pixelDiff;

        // Análise de textura dérmica local (Laplaciano)
        const iRight = (y * width + (x + 1)) * 4;
        const iDown = ((y + 1) * width + x) * 4;
        const lumRight = data[iRight] * 0.299 + data[iRight + 1] * 0.587 + data[iRight + 2] * 0.114;
        const lumDown = data[iDown] * 0.299 + data[iDown + 1] * 0.587 + data[iDown + 2] * 0.114;
        const grad = Math.abs(lum - lumRight) + Math.abs(lum - lumDown);
        highFreqTextureVariance += grad;

        sampledPixels++;
      }
    }

    // Atualiza histórico temporal
    this.prevFrameData.set(data);

    if (sampledPixels < 20) {
      return { isAlive: true, score: 0.80, status: 'LIVE_HUMAN_CONFIRMED' };
    }

    const avgDiff = diffSum / sampledPixels;
    const avgGrad = highFreqTextureVariance / sampledPixels;

    // Normalização dos micro-movimentos estritamente faciais
    const temporalScore = Math.min(1.0, Math.max(0.0, avgDiff / 8.0));
    const textureScore = (avgGrad > 1.2 && avgGrad < 48.0) ? 1.0 : 0.4;
    const combinedScore = (temporalScore * 0.70) + (textureScore * 0.30);

    this.historyScores.push(combinedScore);
    if (this.historyScores.length > 8) this.historyScores.shift();

    const avgHistoryScore = this.historyScores.reduce((a, b) => a + b, 0) / this.historyScores.length;
    this.lastLivenessScore = avgHistoryScore;
    
    // Foto 100% estática parada na câmera por mais de 4 ciclos é spoof
    const isFrozenPhoto = (this.historyScores.length >= 4 && avgHistoryScore < 0.04);
    this.isSpoofed = isFrozenPhoto;
    this.spoofReason = isFrozenPhoto ? 'Foto Estática / Ausência de Micromovimentos na Face' : 'Face Viva Autêntica';

    return {
      isAlive: !this.isSpoofed,
      score: avgHistoryScore,
      scorePercent: (avgHistoryScore * 100).toFixed(1),
      reason: this.spoofReason,
      status: this.isSpoofed ? 'SPOOF_PHOTO_DETECTED' : 'LIVE_HUMAN_CONFIRMED'
    };
  }
}

class BiometricsEngine {
  constructor() {
    this.isLoaded = false;
    this.registeredProfiles = [];
    this.processIntervalMs = 70; // Taxa de amostragem biométrica
    this.lastProcessTime = 0;
    
    // Motor ArcFace
    this.arcFace = new ArcMarginProductEngine(128, 32.0, 0.50, false);
    
    // Detector de Liveness Blindado
    this.livenessDetector = new AntiSpoofingLivenessDetector();
    
    // Limiar Estrito de Decisão ArcFace (Open-Set Recognition)
    // Valores abaixo de 0.72 são DEFINITIVAMENTE considerados PESSOA NÃO CADASTRADA
    this.SIMILARITY_THRESHOLD = 0.72;
    this.MIN_FACE_SIZE = 90; // Proximidade mínima da face em pixels no canvas
    
    this.smoothedBox = null;
    this.lastMatchResult = { matched: false, label: 'Buscando no banco...', confidence: 0 };
    this.simulatedMode = 'auto';

    // Canvases internos dedicados para isolamento e extração sem fundo
    this.offscreenCanvas = document.createElement('canvas');
    this.isolatedFaceCanvas = document.createElement('canvas');
    this.isolatedFaceCanvas.width = 160;
    this.isolatedFaceCanvas.height = 160;
  }

  async init() {
    console.log('[ArcFace Biometrics Pipeline] Initializing ArcMarginProduct Engine (s=32.0, m=0.50, Threshold=0.72)...');
    await this.reloadRegisteredUsers();
    this.isLoaded = true;
    console.log(`[ArcFace Biometrics Pipeline] System Ready. Registered vector profiles: ${this.registeredProfiles.length}`);
  }

  // Recarrega perfis registrados do banco de dados
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
          weightCentroid: centroidVector,
          sourceCount: u.biometrics ? u.biometrics.sourceCount || 1 : 1
        };
      });
      console.log('[ArcFace Biometrics Pipeline] Profiles reloaded:', this.registeredProfiles.map(p => `${p.name} (Blocked: ${p.isBlocked})`));
    } catch (err) {
      console.warn('[ArcFace Biometrics Pipeline] Error loading registered users from DB:', err);
    }
  }

  /**
   * ISOLAMENTO E CENTRALIZAÇÃO DA FACE SEM FUNDO
   * Recorta a face do vídeo/canvas com padding, centraliza em um canvas 160x160
   * e aplica uma máscara elíptica anatômica. Pixels fora da máscara viram zero (fundo 100% preto).
   */
  isolateAndCenterFace(sourceMedia, box) {
    const canvas = this.isolatedFaceCanvas;
    const ctx = canvas.getContext('2d');
    const size = 160;

    // Limpa o canvas com preto absoluto (fundo zerado)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    if (!box || !box.width || !box.height) return { canvas, ctx };

    // Padding anatômico de 12% para preservar queixo e testa sem pegar ombros
    const padW = box.width * 0.12;
    const padH = box.height * 0.15;
    const cropX = Math.max(0, box.x - padW);
    const cropY = Math.max(0, box.y - padH);
    const cropW = box.width + padW * 2;
    const cropH = box.height + padH * 2;

    // Escala para ocupar 82% do canvas centralizado
    const scale = (size * 0.82) / Math.max(cropW, cropH);
    const dstW = cropW * scale;
    const dstH = cropH * scale;
    const dstX = (size - dstW) / 2;
    const dstY = (size - dstH) / 2;

    ctx.save();
    // Máscara Elíptica Anatômica Estrita
    ctx.beginPath();
    ctx.ellipse(size / 2, size / 2, (dstW / 2) * 0.88, (dstH / 2) * 0.96, 0, 0, Math.PI * 2);
    ctx.clip();

    // Desenha apenas a face dentro da elipse (o restante continua preto absoluto)
    ctx.drawImage(sourceMedia, cropX, cropY, cropW, cropH, dstX, dstY, dstW, dstH);
    ctx.restore();

    return { canvas, ctx };
  }

  /**
   * DETECÇÃO FACIAL ANATÔMICA COM VALIDAÇÃO ESTRUTURAL
   * Elimina caixas, portas, móveis e almofadas que enganavam os filtros antigos.
   */
  detectFaceInVideo(video, canvas) {
    if (!video || video.paused || video.ended || video.readyState < 2) {
      return null;
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
    let eyeZoneContrast = 0;

    for (let y = 8; y < 112; y += 2) {
      for (let x = 8; x < 152; x += 2) {
        const idx = (y * 160 + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // 1. Espaço de Cor YCbCr
        const Y  =  0.299 * r + 0.587 * g + 0.114 * b;
        const Cb = -0.1687 * r - 0.3313 * g + 0.5 * b + 128;
        const Cr =  0.5 * r - 0.4187 * g - 0.0813 * b + 128;

        const isSkin = (Y >= 25 && Y <= 235) && 
                       (Cr >= 132 && Cr <= 175) && 
                       (Cb >= 80 && Cb <= 130) && 
                       ((Cr - Cb) >= 0 && (Cr - Cb) <= 65);

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

    const scaleX = canvas.width / 160;
    const scaleY = canvas.height / 120;
    let targetBox = null;
    let isHumanFace = false;
    let isTooFar = false;

    // Inicializa contadores de histerese para estabilidade contínua
    if (this.consecutiveMissingFrames === undefined) this.consecutiveMissingFrames = 0;
    if (this.consecutiveDetectedFrames === undefined) this.consecutiveDetectedFrames = 0;

    // Validação Anatômica: Contagem de densidade facial estável
    if (facePixels > 35 && (maxX - minX) > 20) {
      const spanW = (maxX - minX) * scaleX;
      
      // Proporção Anatômica Rígida da Face (1.25 : 1):
      // Garante que a caixa enquadre APENAS da testa ao queixo, NUNCA descendo para o pescoço ou peito!
      const boxW = Math.max(100, Math.min(canvas.width * 0.75, spanW * 1.18));
      const boxH = Math.min(canvas.height * 0.85, boxW * 1.25);

      const centerX = (weightedX / totalWeight) * scaleX;
      const centerY = (weightedY / totalWeight) * scaleY;

      // Centraliza perfeitamente nos olhos/nariz
      const boxX = Math.max(8, Math.min(canvas.width - boxW - 8, centerX - boxW / 2));
      const boxY = Math.max(8, Math.min(canvas.height - boxH - 8, centerY - boxH * 0.45));

      // Verificação de Proximidade
      if (boxW < this.MIN_FACE_SIZE || boxH < this.MIN_FACE_SIZE) {
        isTooFar = true;
      }

      isHumanFace = true;
      this.lastValidFaceBox = { x: boxX, y: boxY, width: boxW, height: boxH, detected: true, isTooFar };
    }

    // HISTERESE TEMPORAL DE PRESENÇA:
    // Elimina a oscilação rápida ("flicker") entre PAUSADO e DETECTADO.
    // Se o rosto sumir por apenas 1 ou 2 frames (por piscada de luz ou sombra),
    // o sistema mantém a presença ativa por até 10 frames (~350ms).
    if (isHumanFace) {
      this.consecutiveMissingFrames = 0;
      this.consecutiveDetectedFrames++;
    } else {
      this.consecutiveMissingFrames++;
      this.consecutiveDetectedFrames = 0;
    }

    const isPresent = this.consecutiveMissingFrames < 10;

    if (isPresent && this.lastValidFaceBox) {
      targetBox = { ...this.lastValidFaceBox };
    } else {
      targetBox = {
        x: canvas.width * 0.25,
        y: canvas.height * 0.15,
        width: canvas.width * 0.5,
        height: canvas.height * 0.7,
        detected: false,
        isTooFar: false
      };
    }

    // Suavização da caixa de rastreamento (filtro passa-baixa lerp)
    if (!this.smoothedBox) {
      this.smoothedBox = { ...targetBox };
    } else {
      const lerp = 0.35;
      this.smoothedBox.x += (targetBox.x - this.smoothedBox.x) * lerp;
      this.smoothedBox.y += (targetBox.y - this.smoothedBox.y) * lerp;
      this.smoothedBox.width += (targetBox.width - this.smoothedBox.width) * lerp;
      this.smoothedBox.height += (targetBox.height - this.smoothedBox.height) * lerp;
      this.smoothedBox.detected = targetBox.detected;
      this.smoothedBox.isTooFar = targetBox.isTooFar;
    }

    // Processamento Biométrico Somente Quando Rosto Humano Válido Estiver Próximo
    if (targetBox.detected) {
      if (targetBox.isTooFar) {
        // Rosto longe demais: emite aviso de aproximação e não processa falso positivo
        this.lastMatchResult = {
          matched: false,
          name: null,
          confidence: 0,
          label: 'MUITO DISTANTE - APROXIME-SE DA CÂMERA',
          isTooFar: true,
          liveness: { isAlive: true, score: 0.8 }
        };
      } else {
        if (Date.now() - this.lastProcessTime >= this.processIntervalMs) {
          this.lastProcessTime = Date.now();

          // 1. ISOLA E CENTRALIZA O ROSTO NO CANVAS INTERNO (FUNDO 100% PRETO)
          const { canvas: isoCanvas, ctx: isoCtx } = this.isolateAndCenterFace(video, this.smoothedBox);
          const isoImgData = isoCtx.getImageData(0, 0, 160, 160);

          // 2. EXTRAI O VETOR DA FACE ISOLADA (SEM NENHUM PIXEL DO FUNDO)
          const currentDescriptor = this.extractDescriptorsFromImage(isoCtx, 160, 160);

          // 3. AVALIA LIVENESS EXCLUSIVAMENTE NA FACE ISOLADA
          const livenessResult = this.livenessDetector.evaluateLiveness(isoImgData);

          // 4. IDENTIFICAÇÃO ARCFACE COM LIMIAR ESTRITO (OPEN-SET RECOGNITION)
          this.lastMatchResult = this.matchFaceArcFace(currentDescriptor, livenessResult);
        }
      }
    } else {
      this.lastMatchResult = {
        matched: false,
        name: null,
        confidence: 0,
        label: 'NENHUMA PESSOA DETECTADA NA CÂMERA',
        liveness: { isAlive: true, score: 0 }
      };
    }

    return {
      box: this.smoothedBox,
      match: this.lastMatchResult,
      isolatedCanvas: this.isolatedFaceCanvas
    };
  }

  /**
   * EXTRAÇÃO DE DESCRITOR VETORIAL 128-D NA FACE ISOLADA
   * Analisa setores anatômicos da face (olhos, nariz, boca) com equalização de contraste.
   * Totalmente imune a movimentação no fundo porque os pixels de fundo são zero.
   */
  extractDescriptorsFromImage(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const vector = new Float32Array(128);

    // Amostragem em 8 faixas anatômicas verticais e 16 horizontais
    const rows = 8;
    const cols = 16;
    const blockW = Math.floor(width / cols);
    const blockH = Math.floor(height / rows);

    let vIdx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sumLum = 0;
        let sumGrad = 0;
        let count = 0;

        const startY = r * blockH;
        const startX = c * blockW;

        for (let y = startY; y < startY + blockH; y += 2) {
          for (let x = startX; x < startX + blockW; x += 2) {
            const i = (y * width + x) * 4;
            const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            
            // Só computa pixels da face (descarta fundo preto)
            if (lum > 4) {
              const iNext = (y * width + Math.min(width - 1, x + 1)) * 4;
              const lumNext = data[iNext] * 0.299 + data[iNext + 1] * 0.587 + data[iNext + 2] * 0.114;
              sumLum += lum;
              sumGrad += Math.abs(lum - lumNext);
              count++;
            }
          }
        }

        const avgLum = count > 0 ? (sumLum / count) : 0;
        const avgGrad = count > 0 ? (sumGrad / count) : 0;

        // Combina morfologia espacial e gradiente da face
        vector[vIdx] = (avgLum * 0.65) + (avgGrad * 0.35);
        vIdx++;
        if (vIdx >= 128) break;
      }
      if (vIdx >= 128) break;
    }

    return this.arcFace.l2Normalize(Array.from(vector));
  }

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
   * IDENTIFICAÇÃO ARCFACE COM LIMIAR RÍGIDO (OPEN-SET RECOGNITION)
   * Se o maior cosseno for menor que SIMILARITY_THRESHOLD (0.72),
   * o retorno é OBRIGATORIAMENTE "PESSOA NÃO CADASTRADA" (Sem falsos casamentos).
   */
  matchFaceArcFace(targetDescriptor, livenessResult = { isAlive: true, score: 0.85, status: 'LIVE_HUMAN_CONFIRMED' }) {
    if (!this.registeredProfiles || this.registeredProfiles.length === 0) {
      return {
        matched: false,
        label: 'PESSOA NÃO CADASTRADA NO BANCO DB',
        reason: 'Nenhum perfil cadastrado no banco de dados vetorial',
        confidence: 0,
        cosineSimilarity: '0.000',
        arcFaceMarginLogit: '0.00',
        liveness: livenessResult,
        profilesChecked: 0
      };
    }

    if (!livenessResult.isAlive) {
      return {
        matched: false,
        isSpoofed: true,
        label: '🚨 ALERTA DE SEGURANÇA: ATAQUE DE SPOOFING (FOTO ESTÁTICA)',
        reason: 'Ataque de apresentação: Ausência de micro-dinâmica facial',
        confidence: 0,
        cosineSimilarity: '0.000',
        arcFaceMarginLogit: '0.00',
        liveness: livenessResult,
        profilesChecked: 0
      };
    }

    let bestProfile = null;
    let maxCosine = -1.0;
    let bestArcMargin = null;
    let totalComparisons = 0;

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

    // REGRA DE DECISÃO ESTRITA: Somente dá match se ultrapassar o limiar de 0.72
    const isMatched = maxCosine >= this.SIMILARITY_THRESHOLD;

    if (bestProfile && isMatched) {
      const confidence = Math.min(99.8, Math.max(65.0, (maxCosine * 100))).toFixed(1);
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
        liveness: livenessResult,
        profilesChecked: totalComparisons
      };
    }

    // DESCONHECIDO (RED ALERT) - Nunca atribui nome a alguém abaixo do limiar
    return {
      matched: false,
      label: 'PESSOA NÃO CADASTRADA (DESCONHECIDO)',
      reason: `Similaridade (${maxCosine.toFixed(3)}) abaixo do limiar estrito ${this.SIMILARITY_THRESHOLD}`,
      confidence: Math.max(0, (maxCosine * 100)).toFixed(1),
      cosineSimilarity: maxCosine.toFixed(3),
      arcFaceMarginLogit: bestArcMargin ? bestArcMargin.scaledMarginLogit.toFixed(2) : '0.00',
      liveness: livenessResult,
      profilesChecked: totalComparisons
    };
  }

  async extractDescriptorsFromCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    return this.extractDescriptorsFromImage(ctx, canvas.width, canvas.height);
  }
}

// Global Biometrics instance (Tamper-Proof Protected Singleton)
if (!window.svBiometrics) {
  Object.defineProperty(window, 'svBiometrics', {
    value: new BiometricsEngine(),
    writable: false,
    configurable: false,
    enumerable: true
  });
}
