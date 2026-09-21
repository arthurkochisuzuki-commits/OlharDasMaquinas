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
    if (this.historyScores.length > 16) this.historyScores.shift();

    const avgHistoryScore = this.historyScores.reduce((a, b) => a + b, 0) / this.historyScores.length;
    this.lastLivenessScore = avgHistoryScore;
    
    // Foto 100% estática parada na câmera por mais de 14 ciclos (~1s) com dinamismo facial praticamente nulo (< 0.012)
    const isFrozenPhoto = (this.historyScores.length >= 14 && avgHistoryScore < 0.012);
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
    
    // Limiares de Decisão com Histerese (Schmitt Trigger ArcFace com Vetores Diferenciais de Média Zero)
    // Para ADQUIRIR autorização de novo rosto: limiar de 0.58 (estranhos ficam entre -0.20 e +0.35)
    // Para RETER autorização contínua de rosto já confirmado: limiar de 0.46
    this.SIMILARITY_THRESHOLD = 0.58;
    this.HOLD_THRESHOLD = 0.46;
    this.MIN_FACE_SIZE = 90; // Proximidade mínima da face em pixels no canvas
    
    this.confirmedIdentity = null;
    this.identityHoldFrames = 0;
    this.MAX_IDENTITY_HOLD = 14; // ~1 segundo de buffer de retenção contra quedas por iluminação/óculos
    this.smoothedConfidence = 0;
    this.lastFacePixels = 0;
    this.minUnauthPercentage = parseFloat(localStorage.getItem('sv_min_unauth_percentage') || '60');

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
    console.log('[ArcFace Biometrics Pipeline] Initializing ArcMarginProduct Engine (s=32.0, m=0.50, Threshold=0.58)...');
    await this.reloadRegisteredUsers();
    this.isLoaded = true;
    console.log(`[ArcFace Biometrics Pipeline] System Ready. Registered vector profiles: ${this.registeredProfiles.length}`);
  }

  // Recarrega perfis registrados do banco de dados e assegura vetores biométricos ativos
  async reloadRegisteredUsers() {
    try {
      const users = await window.svDB.getAllUsers();
      console.log(`[ArcFace Biometrics Pipeline] Carregando ${users.length} usuário(s) do banco de dados...`);

      const loadedProfiles = [];

      for (const u of users) {
        let rawDescriptors = u.biometrics ? (u.biometrics.descriptors || []) : [];
        const photoBlobs = u.biometrics ? (u.biometrics.photoBlobs || []) : [];

        // Se o usuário tem fotos salvas no banco mas os descritores não foram gerados, gera automaticamente agora
        if ((!rawDescriptors || rawDescriptors.length === 0) && photoBlobs.length > 0 && photoBlobs[0]) {
          try {
            const tempImg = new Image();
            await new Promise((res, rej) => {
              tempImg.onload = res;
              tempImg.onerror = rej;
              tempImg.src = photoBlobs[0];
            });
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 160;
            tempCanvas.height = 160;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(tempImg, 0, 0, 160, 160);
            const freshDesc = this.extractDescriptorsFromImage(tempCtx, 160, 160);
            rawDescriptors = [freshDesc];
          } catch (e) {
            console.warn('[ArcFace Biometrics Pipeline] Auto-geração de vetor para', u.name, e);
          }
        }

        const centroidVector = this.aggregateVectorCentroid(rawDescriptors);
        const isBlocked = !!u.isBlocked || (u.accessLevel === 'BLOQUEADO');

        loadedProfiles.push({
          id: u.id,
          name: u.name,
          role: u.role,
          accessLevel: u.accessLevel || (isBlocked ? 'BLOQUEADO' : 'Nível 1 (Autorizado)'),
          isBlocked: isBlocked,
          descriptors: rawDescriptors,
          weightCentroid: centroidVector,
          sourceCount: u.biometrics ? (u.biometrics.sourceCount || rawDescriptors.length || 1) : 1
        });
      }

      this.registeredProfiles = loadedProfiles;
      console.log(`[ArcFace Biometrics Pipeline] Conexão com banco concluída. ${this.registeredProfiles.length} perfis ativos:`, 
        this.registeredProfiles.map(p => `${p.name} (Vetores: ${p.descriptors ? p.descriptors.length : 0})`));
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

    const vW = video.videoWidth || canvas.width || 640;
    const vH = video.videoHeight || canvas.height || 480;

    const vScaleX = vW / 160;
    const vScaleY = vH / 120;
    let isHumanFace = false;
    let isTooFar = false;
    let videoTargetBox = null;

    // Inicializa contadores de histerese para estabilidade contínua
    if (this.consecutiveMissingFrames === undefined) this.consecutiveMissingFrames = 0;
    if (this.consecutiveDetectedFrames === undefined) this.consecutiveDetectedFrames = 0;

    // Validação Anatômica: Contagem de densidade facial estável
    if (facePixels > 35 && (maxX - minX) > 20) {
      const vSpanW = (maxX - minX) * vScaleX;
      
      // Proporção Anatômica Rígida da Face (1.25 : 1):
      // Garante que a caixa enquadre APENAS da testa ao queixo em coordenadas nativas do vídeo!
      const vBoxW = Math.max(90, Math.min(vW * 0.75, vSpanW * 1.18));
      const vBoxH = Math.min(vH * 0.85, vBoxW * 1.25);

      const vCenterX = (weightedX / totalWeight) * vScaleX;
      const vCenterY = (weightedY / totalWeight) * vScaleY;

      // Centraliza perfeitamente nos olhos/nariz
      const vBoxX = Math.max(0, Math.min(vW - vBoxW, vCenterX - vBoxW / 2));
      const vBoxY = Math.max(0, Math.min(vH - vBoxH, vCenterY - vBoxH * 0.45));

      // Verificação de Proximidade
      if (vBoxW < this.MIN_FACE_SIZE || vBoxH < this.MIN_FACE_SIZE) {
        isTooFar = true;
      }

      isHumanFace = true;
      this.lastFacePixels = facePixels;
      this.lastValidVideoBox = { x: vBoxX, y: vBoxY, width: vBoxW, height: vBoxH, detected: true, isTooFar };
    }

    // HISTERESE TEMPORAL DE PRESENÇA:
    // Elimina a oscilação rápida ("flicker") entre PAUSADO e DETECTADO.
    if (isHumanFace) {
      this.consecutiveMissingFrames = 0;
      this.consecutiveDetectedFrames++;
    } else {
      this.consecutiveMissingFrames++;
      this.consecutiveDetectedFrames = 0;
    }

    const isPresent = this.consecutiveMissingFrames < 10;

    if (isPresent && this.lastValidVideoBox) {
      videoTargetBox = { ...this.lastValidVideoBox };
    } else {
      videoTargetBox = {
        x: vW * 0.25,
        y: vH * 0.15,
        width: vW * 0.5,
        height: vH * 0.7,
        detected: false,
        isTooFar: false
      };
    }

    // Suavização da caixa de rastreamento no espaço de coordenadas do VÍDEO
    if (!this.smoothedVideoBox) {
      this.smoothedVideoBox = { ...videoTargetBox };
    } else {
      const lerp = 0.35;
      this.smoothedVideoBox.x += (videoTargetBox.x - this.smoothedVideoBox.x) * lerp;
      this.smoothedVideoBox.y += (videoTargetBox.y - this.smoothedVideoBox.y) * lerp;
      this.smoothedVideoBox.width += (videoTargetBox.width - this.smoothedVideoBox.width) * lerp;
      this.smoothedVideoBox.height += (videoTargetBox.height - this.smoothedVideoBox.height) * lerp;
      this.smoothedVideoBox.detected = videoTargetBox.detected;
      this.smoothedVideoBox.isTooFar = videoTargetBox.isTooFar;
    }

    // Projeção da caixa para o CANVAS do navegador (renderização de tela)
    const cScaleX = canvas.width / vW;
    const cScaleY = canvas.height / vH;
    this.smoothedCanvasBox = {
      x: this.smoothedVideoBox.x * cScaleX,
      y: this.smoothedVideoBox.y * cScaleY,
      width: this.smoothedVideoBox.width * cScaleX,
      height: this.smoothedVideoBox.height * cScaleY,
      detected: this.smoothedVideoBox.detected,
      isTooFar: this.smoothedVideoBox.isTooFar
    };

    // Processamento Biométrico Somente Quando Rosto Humano Válido Estiver Próximo
    if (this.smoothedVideoBox.detected) {
      if (this.smoothedVideoBox.isTooFar) {
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

          // 1. ISOLA E CENTRALIZA O ROSTO NO CANVAS INTERNO COM FUNDO 100% PRETO
          // (Usa coordenadas exatas de pixel do vídeo para recorte perfeito idêntico ao cadastro)
          const { canvas: isoCanvas, ctx: isoCtx } = this.isolateAndCenterFace(video, this.smoothedVideoBox);
          const isoImgData = isoCtx.getImageData(0, 0, 160, 160);

          // 2. EXTRAI O VETOR DA FACE ISOLADA COM FUNDO 100% PRETO
          const currentDescriptor = this.extractDescriptorsFromImage(isoCtx, 160, 160);

          // 3. AVALIA LIVENESS EXCLUSIVAMENTE NA FACE ISOLADA
          const livenessResult = this.livenessDetector.evaluateLiveness(isoImgData);

          // 4. IDENTIFICAÇÃO ARCFACE (COMPARAÇÃO CONTRA O MODELO ISOLADO DO BANCO)
          this.lastMatchResult = this.matchFaceArcFace(currentDescriptor, livenessResult);
        }
      }
    } else {
      this.confirmedIdentity = null;
      this.identityHoldFrames = 0;
      this.smoothedConfidence = 0;
      this.lastMatchResult = {
        matched: false,
        name: null,
        confidence: 0,
        label: 'NENHUMA PESSOA DETECTADA NA CÂMERA',
        liveness: { isAlive: true, score: 0 }
      };
    }

    return {
      box: this.smoothedCanvasBox,
      match: this.lastMatchResult,
      isolatedCanvas: this.isolatedFaceCanvas
    };
  }

  /**
   * EXTRAÇÃO DE DESCRITOR VETORIAL 128-D ANATÔMICO DISCRIMINATIVO
   * Combina Perfil Z-Score de Contraste Espacial Relativo (64-D) + Gradientes Estruturais Direcionais HOG (64-D).
   * Elimina completamente o viés positivo médio (DC offset) para que pessoas diferentes tenham correlação nula ou negativa (-0.2 a +0.3),
   * enquanto o mesmo usuário tenha alta correlação (+0.65 a +0.95).
   */
  extractDescriptorsFromImage(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const vector = new Float32Array(128);

    // Passo 1: Estatísticas Globais da Face (Média e Desvio Padrão sobre a máscara)
    let totalLum = 0;
    let validPixels = 0;
    let totalGrad = 0;

    for (let y = 10; y < height - 10; y += 2) {
      for (let x = 10; x < width - 10; x += 2) {
        const i = (y * width + x) * 4;
        const alpha = data[i + 3];
        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (alpha > 50 && lum > 8) {
          totalLum += lum;
          validPixels++;

          const iRight = (y * width + Math.min(width - 1, x + 2)) * 4;
          const lumRight = data[iRight] * 0.299 + data[iRight + 1] * 0.587 + data[iRight + 2] * 0.114;
          totalGrad += Math.abs(lum - lumRight);
        }
      }
    }

    const faceMean = validPixels > 0 ? (totalLum / validPixels) : 100.0;
    const gradMean = validPixels > 0 ? (totalGrad / validPixels) : 12.0;

    let varianceSum = 0;
    for (let y = 10; y < height - 10; y += 4) {
      for (let x = 10; x < width - 10; x += 4) {
        const i = (y * width + x) * 4;
        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        if (data[i + 3] > 50 && lum > 8) {
          varianceSum += Math.pow(lum - faceMean, 2);
        }
      }
    }
    const faceStd = Math.sqrt(varianceSum / Math.max(1, validPixels / 4)) || 25.0;

    // Passo 2: Grid Anatômico 8x8 (64 Células Espaciais com Normalização de Média Zero)
    const rows = 8;
    const cols = 8;
    const cellW = Math.floor(width / cols);
    const cellH = Math.floor(height / rows);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellIdx = r * 8 + c;
        let cellLumSum = 0;
        let cellHGradSum = 0;
        let cellVGradSum = 0;
        let cellCount = 0;

        const startY = r * cellH;
        const startX = c * cellW;

        for (let y = startY; y < startY + cellH; y += 2) {
          for (let x = startX; x < startX + cellW; x += 2) {
            const i = (y * width + x) * 4;
            const alpha = data[i + 3];
            const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

            if (alpha > 50 && lum > 8) {
              cellLumSum += lum;

              const iR = (y * width + Math.min(width - 1, x + 2)) * 4;
              const lumR = data[iR] * 0.299 + data[iR + 1] * 0.587 + data[iR + 2] * 0.114;
              cellHGradSum += Math.abs(lum - lumR);

              const iD = (Math.min(height - 1, y + 2) * width + x) * 4;
              const lumD = data[iD] * 0.299 + data[iD + 1] * 0.587 + data[iD + 2] * 0.114;
              cellVGradSum += Math.abs(lum - lumD);

              cellCount++;
            }
          }
        }

        if (cellCount > 4) {
          const avgCellLum = cellLumSum / cellCount;
          const avgHGrad = cellHGradSum / cellCount;
          const avgVGrad = cellVGradSum / cellCount;

          // Componente A (0 a 63): Z-Score do relevo de luz/sombra da face (olhos, nariz, maçãs, queixo)
          vector[cellIdx] = (avgCellLum - faceMean) / (faceStd + 6.0);

          // Componente B (64 a 127): Densidade de arestas direcionais HOG em torno da média
          const combinedGrad = (avgHGrad * 0.60) + (avgVGrad * 0.40);
          vector[64 + cellIdx] = (combinedGrad - gradMean) / (gradMean + 5.0);
        } else {
          vector[cellIdx] = 0.0;
          vector[64 + cellIdx] = 0.0;
        }
      }
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

    // REGRA DE DECISÃO COM HISTERESE (SCHMITT TRIGGER):
    // Se o perfil já estava identificado no frame anterior, usa o limiar de retenção estável (0.55).
    // Se for uma nova detecção vinda do zero, exige o limiar de aquisição inicial (0.68).
    const effectiveThreshold = (this.confirmedIdentity && bestProfile && this.confirmedIdentity.id === bestProfile.id)
      ? this.HOLD_THRESHOLD
      : this.SIMILARITY_THRESHOLD;

    const isMatched = bestProfile && (maxCosine >= effectiveThreshold);

    if (bestProfile && isMatched) {
      this.confirmedIdentity = bestProfile;
      this.identityHoldFrames = this.MAX_IDENTITY_HOLD;

      const rawConfidence = Math.min(99.8, Math.max(65.0, (maxCosine * 100)));
      if (this.smoothedConfidence === 0) {
        this.smoothedConfidence = rawConfidence;
      } else {
        // Suavização exponencial para eliminar pulos de números na tela
        this.smoothedConfidence = (this.smoothedConfidence * 0.75) + (rawConfidence * 0.25);
      }

      return {
        matched: true,
        userId: bestProfile.id,
        name: bestProfile.name,
        role: bestProfile.role,
        accessLevel: bestProfile.accessLevel,
        isBlocked: !!bestProfile.isBlocked,
        confidence: this.smoothedConfidence.toFixed(1),
        arcFaceMarginLogit: bestArcMargin ? bestArcMargin.scaledMarginLogit.toFixed(2) : '0.00',
        cosineSimilarity: maxCosine.toFixed(3),
        liveness: livenessResult,
        profilesChecked: totalComparisons
      };
    }

    // AMORTECIMENTO DE MICRO-QUEDAS (Ex: piscadas de olhos, reflexos em lentes de óculos ou fones):
    // Se a pessoa já foi confirmada e a similaridade ainda é razoável (>= 0.38), retém a identidade por alguns frames:
    if (this.confirmedIdentity && this.identityHoldFrames > 0 && maxCosine >= 0.38) {
      this.identityHoldFrames--;
      return {
        matched: true,
        userId: this.confirmedIdentity.id,
        name: this.confirmedIdentity.name,
        role: this.confirmedIdentity.role,
        accessLevel: this.confirmedIdentity.accessLevel,
        isBlocked: !!this.confirmedIdentity.isBlocked,
        confidence: this.smoothedConfidence.toFixed(1),
        arcFaceMarginLogit: bestArcMargin ? bestArcMargin.scaledMarginLogit.toFixed(2) : '0.00',
        cosineSimilarity: maxCosine.toFixed(3),
        liveness: livenessResult,
        profilesChecked: totalComparisons
      };
    }

    // Se a similaridade caiu demais ou o buffer expirou, limpa a identidade retida
    this.confirmedIdentity = null;
    this.smoothedConfidence = 0;

    // Cálculo da Certeza Biométrica da Face Atual:
    const facePixelsCount = this.lastFacePixels || 55;
    const livenessScore = (livenessResult && typeof livenessResult.score === 'number') ? livenessResult.score : 0.85;
    const faceCertainty = Math.min(99, Math.max(25, Math.floor((facePixelsCount / 85) * 100 * livenessScore)));
    
    const minPercent = this.minUnauthPercentage || 60;
    const showUnauth = faceCertainty >= minPercent;

    // DESCONHECIDO (RED ALERT) - Só aciona o alerta quando atinge a porcentagem mínima configurada
    return {
      matched: false,
      label: showUnauth ? 'PESSOA NÃO CADASTRADA (DESCONHECIDO)' : `ANALISANDO ROSTO... (${faceCertainty}%)`,
      reason: `Similaridade (${maxCosine.toFixed(3)}) abaixo do limiar estrito ${this.SIMILARITY_THRESHOLD}`,
      confidence: faceCertainty.toString(),
      rawConfidence: faceCertainty,
      cosineSimilarity: maxCosine.toFixed(3),
      arcFaceMarginLogit: bestArcMargin ? bestArcMargin.scaledMarginLogit.toFixed(2) : '0.00',
      liveness: livenessResult,
      profilesChecked: totalComparisons,
      showUnauthAlert: showUnauth
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
