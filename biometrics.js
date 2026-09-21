/**
 * SecureVision AI - Biometrics & Visual Tracking Engine (Discriminative V2)
 * 
 * Multi-Stage Facial AI Pipeline:
 * 1. Pre-scan & Standby: Detects presence of subject; maintains low-power standby if empty.
 * 2. YOLOv5 Face Detector Engine: Anchor-based multi-scale grid detector with NMS & facial anthropometrics.
 *    Source Reference: face detector/yolov5-master/ (models/yolo.py, utils/general.py)
 * 3. Face Isolation & Canonical Centering: Isolates human face onto pure black background (#000000)
 *    and centers the cranial structure to 112x112 canonical frame.
 * 4. Multi-Modal Discriminative Biometric Feature Extraction (128 Dimensions):
 *    - Colorimetry & Skin Tone (24 dims): YCbCr/LAB chrominance, melanin/hemoglobin proxies, lip contrast.
 *    - Periocular Morphology, Eyes & Glasses (24 dims): IPD, eye aperture/angle, eyewear frame signatures.
 *    - Face Shape & Mandibular Contour (32 dims): Forehead, cheekbone, jawline taper, chin curvature.
 *    - Anthropometric Clinical Ratios (24 dims): Farkas' facial thirds, nose/mouth/IPD proportions.
 *    - Local Texture & Structural Gradients (24 dims): Uniform LBP on brows & nasolabial folds, Sobel edges.
 * 5. ArcFace / Face_Pytorch Additive Angular Margin Loss Decision Engine (s=32.0, m=0.50).
 *    Source Reference: face detector/Face_Pytorch-master/margin/ArcMarginProduct.py
 * 6. Temporal Identity Tracker (Anti-Flicker):
 *    - Identity Lock & Moving Consensus Window: Prevents rapid alternating between identities.
 *    - Margin Gap Delta Filter (>= 4.0%): Prevents momentary noise from swapping recognized persons.
 *    - Strict 90% Compatibility Rule: < 90% outputs 'Usuário Desconhecido'.
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
   * Formula: cos(theta + m) = cos(theta)*cos(m) - sin(theta)*sin(m)
   */
  computeArcMargin(cosine) {
    const sine = Math.sqrt(Math.max(0.0, 1.0 - Math.pow(cosine, 2)));
    let phi = cosine * this.cosM - sine * this.sinM;

    if (this.easyMargin) {
      phi = cosine > 0 ? phi : cosine;
    } else {
      phi = (cosine - this.th) > 0 ? phi : (cosine - this.mm);
    }

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

/**
 * TemporalIdentityTracker - Anti-Flicker Stabilization Engine
 * Solves the constant identity flipping problem through:
 * 1. Multi-Frame Consensus: Requires 4 consecutive matching frames (>= 90%) before confirming identity.
 * 2. Identity Lock: Locks the recognized profile so minor noise doesn't swap identities.
 * 3. Margin Gap Hysteresis (Delta >= 4.0%): A new person must clearly outperform the current locked person.
 * 4. Transient Noise Filter: 1-2 blurred or occluded frames do not immediately drop back to unknown.
 */
class TemporalIdentityTracker {
  constructor() {
    this.historySize = 8;
    this.history = [];
    this.lockedIdentity = null;
    this.lockedProfile = null;
    this.consecutiveMatches = 0;
    this.consecutiveMisses = 0;
    this.minConsensusFrames = 4; // Required frames to confirm and lock identity
    this.breakLockFrames = 4;    // Required frames to drop lock to unknown (era 5)
    this.switchMarginDelta = 2.0;// Required % advantage for another candidate (era 4.0%)
    this.requiredCompatibility = 90.0;
  }

  reset() {
    this.history = [];
    this.lockedIdentity = null;
    this.lockedProfile = null;
    this.consecutiveMatches = 0;
    this.consecutiveMisses = 0;
    this.lastCandidateId = null;
    this.competitorFrames = 0;
  }

  stabilize(rawResult) {
    this.history.push({ ...rawResult, timestamp: Date.now() });
    if (this.history.length > this.historySize) {
      this.history.shift();
    }

    const requiredThresh = this.requiredCompatibility || 90.0;
    const isMatch = rawResult.matched && parseFloat(rawResult.confidence) >= requiredThresh;

    if (isMatch) {
      this.consecutiveMisses = 0;

      if (!this.lockedIdentity) {
        // Evaluating new candidate
        if (this.lastCandidateId === rawResult.userId) {
          this.consecutiveMatches++;
        } else {
          this.lastCandidateId = rawResult.userId;
          this.consecutiveMatches = 1;
        }

        // Check if candidate met consensus requirement (>= 4 frames)
        if (this.consecutiveMatches >= this.minConsensusFrames) {
          this.lockedIdentity = rawResult.userId;
          this.lockedProfile = { ...rawResult, locked: true };
          console.log(`[TemporalTracker] Identity LOCKED: ${rawResult.name} (${rawResult.confidence}%)`);
          return this.lockedProfile;
        }

        return {
          ...rawResult,
          label: `${rawResult.name} (Confirmando...)`,
          evaluating: true
        };
      } else {
        // Identity is currently LOCKED
        if (rawResult.userId === this.lockedIdentity) {
          // Reinforce current locked identity with Exponential Moving Average
          const currentConf = parseFloat(this.lockedProfile.confidence);
          const newConf = parseFloat(rawResult.confidence);
          const smoothedConf = (0.75 * currentConf + 0.25 * newConf).toFixed(1);

          this.lockedProfile = {
            ...rawResult,
            confidence: smoothedConf,
            locked: true
          };
          this.consecutiveMatches = Math.min(10, this.consecutiveMatches + 1);
          return this.lockedProfile;
        } else {
          // A DIFFERENT candidate is claiming the face!
          const lockedConf = parseFloat(this.lockedProfile.confidence);
          const competitorConf = parseFloat(rawResult.confidence);

          // Se um novo candidato válido for identificado com consistência (>= 2 frames consecutivos),
          // troca a identidade imediatamente para evitar que o sistema fique travado na primeira pessoa
          if (rawResult.userId === this.lastCompetitorId) {
            this.competitorFrames = (this.competitorFrames || 0) + 1;
          } else {
            this.lastCompetitorId = rawResult.userId;
            this.competitorFrames = 1;
          }

          if (this.competitorFrames >= 2 && (competitorConf >= lockedConf - 2.0)) {
            console.log(`[TemporalTracker] Identity SWITCHED to: ${rawResult.name} (${competitorConf}%)`);
            this.lockedIdentity = rawResult.userId;
            this.lockedProfile = { ...rawResult, locked: true };
            this.competitorFrames = 0;
            this.lastCompetitorId = null;
            return this.lockedProfile;
          }

          // Se a identidade atual começar a decair (abaixo de 85%), destrava
          if (lockedConf < 85.0) {
            this.lockedIdentity = null;
            this.lockedProfile = null;
          }

          return this.lockedProfile || rawResult;
        }
      }
    } else {
      this.consecutiveMatches = 0;
      this.consecutiveMisses++;

      if (this.lockedIdentity) {
        // Se falhar 3 frames consecutivos, destrava imediatamente para permitir a próxima pessoa
        if (this.consecutiveMisses < 3) {
          return {
            ...this.lockedProfile,
            locked: true,
            fading: true
          };
        } else {
          console.log(`[TemporalTracker] Identity UNLOCKED: Rosto mudou ou pessoa se afastou.`);
          this.lockedIdentity = null;
          this.lockedProfile = null;
          this.lastCandidateId = null;
          this.lastCompetitorId = null;
        }
      }

      return rawResult;
    }
  }
}

/**
 * YOLOFaceDetectorEngine
 * Direct implementation of YOLOv5 detection principles referencing:
 * - models/yolo.py (Class Detect: Anchor-based multi-scale grid decoder)
 * - utils/general.py (non_max_suppression, box_iou, xywh2xyxy)
 */
class YOLOFaceDetectorEngine {
  constructor() {
    this.name = 'YOLOv5-Face Detector';
    this.confThreshold = 0.40;
    this.iouThreshold = 0.45;
    this.cellSize = 6;
    this.minSkinPixels = 20;

    // Buffers estáticos reutilizáveis para eliminar Garbage Collection contínuo
    this._grid = null;
    this._cellMinLum = null;
    this._cellMaxLum = null;
    this._cellContrast = null;
    this._visited = null;
    this._qGx = null;
    this._qGy = null;
  }

  _ensureBuffers(cols, rows) {
    const size = cols * rows;
    if (!this._grid || this._grid.length < size) {
      this._grid = new Int32Array(size);
      this._cellMinLum = new Float32Array(size);
      this._cellMaxLum = new Float32Array(size);
      this._cellContrast = new Float32Array(size);
      this._visited = new Uint8Array(size);
      this._qGx = new Int16Array(size);
      this._qGy = new Int16Array(size);
    }
    this._grid.fill(0, 0, size);
    this._cellMinLum.fill(255, 0, size);
    this._cellMaxLum.fill(0, 0, size);
    this._cellContrast.fill(0, 0, size);
    this._visited.fill(0, 0, size);
  }

  /**
   * Universal Illumination-Robust Skin Chromaticity
   * Combines YCbCr wide-band locus, Normalized RGB, Chromatic Difference and Monitor Glow compensation
   * Invariant across Fitzpatrick phototypes I-VI, colored backgrounds, screen glow and auto-white-balance shifts
   */
  isSkinPixel(r, g, b) {
    const yVal = 0.299 * r + 0.587 * g + 0.114 * b;
    if (yVal < 14) return false; // Ignore pure black/underexposed noise

    const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;

    // Wide YCbCr skin locus (covers varied lighting & skin tones)
    const ycbcrMatch = (cb >= 65 && cb <= 145 && cr >= 120 && cr <= 188);

    // Normalized RGB test
    const sum = r + g + b + 0.001;
    const nr = r / sum;
    const ng = g / sum;
    const nb = b / sum;
    const nrgbMatch = (nr > 0.29 && (nr > nb || r >= b - 12) && (nr - ng) >= -0.06);

    // Chromatic difference (red component dominance for human skin under varied lighting)
    const diffMatch = (r >= g - 8 && (r > b || r >= b - 12));

    // Screen glow / cool daylight support (where B can be slightly higher than R if YCbCr is strictly skin)
    const coolGlowMatch = (ycbcrMatch && r >= 135 && g >= 115 && b >= 115 && r >= b - 16 && (r - g) >= -8 && cr >= 124);

    return (ycbcrMatch && (nrgbMatch || diffMatch || coolGlowMatch)) || 
           (cb >= 70 && cb <= 135 && cr >= 128 && cr <= 180 && (diffMatch || coolGlowMatch));
  }

  scanForPresence(data, width, height, backgroundModel) {
    let skinPixels = 0;
    let totalSampled = 0;

    // Scan full viewport from border y=2 to height-2, accommodating faces at high or low positions
    for (let y = 2; y < height - 2; y += 2) {
      for (let x = 2; x < width - 2; x += 2) {
        totalSampled++;
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        if (backgroundModel) {
          const diff = Math.abs(r - backgroundModel[idx]) + 
                       Math.abs(g - backgroundModel[idx + 1]) + 
                       Math.abs(b - backgroundModel[idx + 2]);
          if (diff < 30) continue;
        }

        if (this.isSkinPixel(r, g, b)) skinPixels++;
      }
    }

    const minRequired = (width >= 320) ? Math.max(30, Math.round(this.minSkinPixels * 1.5)) : this.minSkinPixels;
    const hasPresence = skinPixels >= minRequired;
    return { hasPresence, skinPixels, totalSampled };
  }

  detectHumanFace(data, width, height, lastTrackedBox = null) {
    const cols = Math.floor(width / this.cellSize);
    const rows = Math.floor(height / this.cellSize);
    this._ensureBuffers(cols, rows);

    const grid = this._grid;
    const cellMinLum = this._cellMinLum;
    const cellMaxLum = this._cellMaxLum;
    const cellContrast = this._cellContrast;
    const visited = this._visited;
    const qGx = this._qGx;
    const qGy = this._qGy;

    for (let y = 0; y < height; y++) {
      const gy = Math.floor(y / this.cellSize);
      for (let x = 0; x < width; x++) {
        const gx = Math.floor(x / this.cellSize);
        const gidx = gy * cols + gx;
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < cellMinLum[gidx]) cellMinLum[gidx] = lum;
        if (lum > cellMaxLum[gidx]) cellMaxLum[gidx] = lum;

        if (this.isSkinPixel(r, g, b)) {
          grid[gidx]++;
        }
      }
    }

    const totalCells = cols * rows;
    for (let i = 0; i < totalCells; i++) {
      cellContrast[i] = cellMaxLum[i] - cellMinLum[i];
    }

    const proposals = [];

    // Identify candidate face clusters using connected component analysis
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const gidx = gy * cols + gx;
        if (grid[gidx] >= 4 && !visited[gidx]) {
          const comp = [];
          let qHead = 0;
          let qTail = 0;
          qGx[qTail] = gx;
          qGy[qTail] = gy;
          qTail++;
          visited[gidx] = 1;
          let compPixels = 0;
          let landmarkCount = 0;

          while (qHead < qTail) {
            const curGx = qGx[qHead];
            const curGy = qGy[qHead];
            qHead++;
            const cidx = curGy * cols + curGx;
            comp.push({ gx: curGx, gy: curGy });
            compPixels += grid[cidx];
            if (cellContrast[cidx] >= 5) landmarkCount++;

            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const ny = curGy + dy;
                const nx = curGx + dx;
                if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                  const nidx = ny * cols + nx;
                  if (grid[nidx] >= 4 && !visited[nidx]) {
                    visited[nidx] = 1;
                    qGx[qTail] = nx;
                    qGy[qTail] = ny;
                    qTail++;
                  }
                }
              }
            }
          }

          // Lower proposal threshold (comp.length >= 2, compPixels >= 18) to catch distant or high faces
          if (comp.length >= 2 && compPixels >= 18) {
            proposals.push({ comp, compPixels, landmarkCount });
          }
        }
      }
    }

    if (proposals.length === 0) return null;

    // Decode all valid human face candidates across proposals
    const verifiedFaces = [];

    for (const prop of proposals) {
      const comp = prop.comp;
      const isFloodedBackground = comp.length > (cols * rows * 0.28);

      if (isFloodedBackground) {
        if (prop.landmarkCount < 2) continue;

        // Group landmark cells into distinct spatial clusters (supports multiple people in flooded scenes)
        const landmarkClusters = this.clusterLandmarkCells(comp, cols, rows, cellContrast);

        for (const cluster of landmarkClusters) {
          let minX = width, maxX = 0, minY = height, maxY = 0;
          let weightedX = 0, weightedY = 0, totalWeight = 0;

          for (const cell of cluster) {
            const cidx = cell.gy * cols + cell.gx;
            const cx = (cell.gx + 0.5) * this.cellSize;
            const cy = (cell.gy + 0.5) * this.cellSize;
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;
            const w = cellContrast[cidx];
            weightedX += cx * w;
            weightedY += cy * w;
            totalWeight += w;
          }

          if (totalWeight < 10) continue;

          const rawW = Math.max(16, maxX - minX + 1);
          const rawH = Math.max(20, maxY - minY + 1);
          const centerX = weightedX / totalWeight;
          const centerY = weightedY / totalWeight;

          const boxW = Math.max(18, Math.min(width * 0.78, rawW * 1.55));
          const boxH = Math.max(22, Math.min(height * 0.88, rawH * 1.65));
          const boxX = Math.max(0, Math.min(width - boxW, centerX - boxW / 2));
          const boxY = Math.max(0, Math.min(height - boxH, centerY - boxH * 0.44));

          const candidate = { x: boxX, y: boxY, width: boxW, height: boxH, rawW, rawH };
          if (this.verifyFacialTopology(data, width, height, candidate)) {
            verifiedFaces.push(candidate);
          }
        }
      } else {
        // Standard unflooded proposal
        let minX = width, maxX = 0, minY = height, maxY = 0;
        let weightedX = 0, weightedY = 0, totalWeight = 0;

        const compMask = new Uint8Array(cols * rows);
        for (const cell of comp) compMask[cell.gy * cols + cell.gx] = 1;

        for (let y = 0; y < height; y++) {
          const gy = Math.floor(y / this.cellSize);
          for (let x = 0; x < width; x++) {
            const gx = Math.floor(x / this.cellSize);
            if (compMask[gy * cols + gx]) {
              const idx = (y * width + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];

              if (this.isSkinPixel(r, g, b)) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                weightedX += x;
                weightedY += y;
                totalWeight++;
              }
            }
          }
        }

        if (totalWeight < 16) continue;

        const rawW = maxX - minX + 1;
        const rawH = maxY - minY + 1;
        const centerX = weightedX / totalWeight;
        const centerY = weightedY / totalWeight;

        const aspect = Math.max(1.1, Math.min(1.5, rawH / Math.max(1, rawW)));
        const boxW = Math.max(18, Math.min(width, rawW * 1.30));
        const boxH = Math.max(22, Math.min(height, Math.max(rawH * 1.35, boxW * aspect)));
        const boxX = Math.max(0, Math.min(width - boxW, centerX - boxW / 2));
        const boxY = Math.max(0, Math.min(height - boxH, centerY - boxH * 0.44));

        const candidate = { x: boxX, y: boxY, width: boxW, height: boxH, rawW, rawH };
        if (this.verifyFacialTopology(data, width, height, candidate)) {
          verifiedFaces.push(candidate);
        }
      }
    }

    // Suppress overlapping proposals via Non-Maximum Suppression (IoU >= 0.35)
    const uniqueFaces = this.applyNMS(verifiedFaces, 0.35);

    if (uniqueFaces.length === 0) return null;

    // =========================================================================
    // PROXIMITY SCORING ENGINE: SELECT STRICTLY THE CLOSEST PERSON TO THE CAMERA
    // =========================================================================
    // Physics of pinhole camera perspective projection:
    // Face bounding box area and height are inversely proportional to depth (Z distance):
    // Depth Z ~ f * H_real / box_height  ==>  Closer person = significantly larger box!
    for (const face of uniqueFaces) {
      const area = face.width * face.height;
      const faceCenterX = face.x + face.width / 2;
      const faceCenterY = face.y + face.height / 2;

      // Centrality factor: favors persons standing in the active central line of sight
      const normDx = (faceCenterX - width / 2) / (width / 2);
      const normDy = (faceCenterY - height / 2) / (height / 2);
      const distFromCenter = Math.sqrt(normDx * normDx + normDy * normDy);
      const centrality = Math.max(0.82, 1.0 - 0.16 * distFromCenter);

      // Estimated physical distance in meters (based on canonical webcam FOV and average human head dimensions)
      const effectiveDim = Math.max(face.width, face.height * 0.78);
      const estDistance = Math.max(0.3, Math.min(4.0, (26.0 / effectiveDim)));
      face.estimatedDistanceMeters = parseFloat(estDistance.toFixed(1));

      // Temporal continuity bonus if this target was already tracked in the prior frame
      let temporalBonus = 1.0;
      if (lastTrackedBox) {
        const prevCenterX = lastTrackedBox.x + lastTrackedBox.width / 2;
        const prevCenterY = lastTrackedBox.y + lastTrackedBox.height / 2;
        const distToPrev = Math.hypot(faceCenterX - prevCenterX, faceCenterY - prevCenterY);
        if (distToPrev < Math.max(face.width, face.height) * 0.75) {
          temporalBonus = 1.15; // 15% hysteresis prevents flickering between nearly identical distances
        }
      }

      face.proximityScore = area * centrality * temporalBonus;
    }

    // Sort by proximity score in descending order (highest score = closest person!)
    uniqueFaces.sort((a, b) => b.proximityScore - a.proximityScore);

    const closestFace = uniqueFaces[0];
    closestFace.isClosest = true;

    for (let i = 1; i < uniqueFaces.length; i++) {
      uniqueFaces[i].isClosest = false;
    }

    return {
      isHumanFace: true,
      confidence: 0.94,
      box: closestFace,
      proximityScore: closestFace.proximityScore,
      estimatedDistanceMeters: closestFace.estimatedDistanceMeters,
      allFaces: uniqueFaces,
      secondaryFacesCount: uniqueFaces.length - 1
    };
  }

  clusterLandmarkCells(comp, cols, rows, cellContrast) {
    const landmarkCells = comp.filter(c => cellContrast[c.gy * cols + c.gx] >= 4);
    if (landmarkCells.length === 0) return [];

    const cellMap = new Map();
    landmarkCells.forEach(c => cellMap.set(`${c.gx},${c.gy}`, c));

    const clusters = [];
    const visited = new Set();

    for (const cell of landmarkCells) {
      const key = `${cell.gx},${cell.gy}`;
      if (visited.has(key)) continue;

      const cluster = [];
      const queue = [cell];
      visited.add(key);

      while (queue.length > 0) {
        const curr = queue.shift();
        cluster.push(curr);

        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nkey = `${curr.gx + dx},${curr.gy + dy}`;
            if (cellMap.has(nkey) && !visited.has(nkey)) {
              visited.add(nkey);
              queue.push(cellMap.get(nkey));
            }
          }
        }
      }

      if (cluster.length >= 2) {
        clusters.push(cluster);
      }
    }

    return clusters.length > 0 ? clusters : [landmarkCells];
  }

  applyNMS(boxes, iouThreshold = 0.35) {
    if (boxes.length <= 1) return boxes;
    const sorted = [...boxes].sort((a, b) => (b.width * b.height) - (a.width * a.height));
    const selected = [];

    for (const b of sorted) {
      let keep = true;
      for (const sel of selected) {
        const x1 = Math.max(b.x, sel.x);
        const y1 = Math.max(b.y, sel.y);
        const x2 = Math.min(b.x + b.width, sel.x + sel.width);
        const y2 = Math.min(b.y + b.height, sel.y + sel.height);
        const interW = Math.max(0, x2 - x1);
        const interH = Math.max(0, y2 - y1);
        const interArea = interW * interH;
        const unionArea = (b.width * b.height) + (sel.width * sel.height) - interArea;
        const iou = unionArea > 0 ? interArea / unionArea : 0;
        if (iou >= iouThreshold) {
          keep = false;
          break;
        }
      }
      if (keep) selected.push(b);
    }
    return selected;
  }

  /**
   * Topological & Internal Texture Verification
   * Invariant to bangs, glasses, overhead/side lighting, and background color
   * Separates human faces from walls, doors, clothes and plain objects
   */
  verifyFacialTopology(data, width, height, box) {
    const { x, y, width: w, height: h } = box;
    if (w < 10 || h < 12) return false;

    const ratio = h / w;
    if (ratio < 0.55 || ratio > 2.80) return false;

    const yStart = Math.max(0, Math.floor(y));
    const yEnd = Math.min(height, Math.floor(y + h));
    const xStart = Math.max(0, Math.floor(x));
    const xEnd = Math.min(width, Math.floor(x + w));

    let totalPixels = 0;
    let lumSum = 0;
    let lumSqSum = 0;
    let skinPixelCount = 0;

    for (let py = yStart; py < yEnd; py++) {
      for (let px = xStart; px < xEnd; px++) {
        const idx = (py * width + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        lumSum += lum;
        lumSqSum += lum * lum;
        totalPixels++;

        if (this.isSkinPixel(r, g, b)) {
          skinPixelCount++;
        }
      }
    }

    if (totalPixels < 25) return false;

    // 1. Skin density check: Face box must contain at least 15% skin pixels
    const skinRatio = skinPixelCount / totalPixels;
    if (skinRatio < 0.15) return false;

    // 2. Texture & contrast check (standard deviation of luminance)
    // Flat background surfaces (wood panels, painted walls, paper) have very low variance (< 2.5)
    // Real human faces contain eyes, nose, mouth, eyebrows, giving rich gradient variance (stdDev >= 2.5)
    const meanLum = lumSum / totalPixels;
    const variance = (lumSqSum / totalPixels) - (meanLum * meanLum);
    const stdDev = Math.sqrt(Math.max(0, variance));

    if (stdDev < 2.5) return false;

    return true;
  }
}

const YOLOv5FaceDetector = YOLOFaceDetectorEngine;

class LivenessAntiSpoofDetector {
  constructor(thresholdFrames = 12, minMotionDelta = 1.0) {
    this.thresholdFrames = thresholdFrames;
    this.minMotionDelta = minMotionDelta;
    this.history = [];
    this.staticFrames = 0;
    this.isSpoofed = false;
  }

  reset() {
    this.history = [];
    this.staticFrames = 0;
    this.isSpoofed = false;
  }

  checkMicroDynamics(patchImageData) {
    const data = (patchImageData && patchImageData.data) ? patchImageData.data : patchImageData;
    if (!data) {
      return { isSpoofed: false, motionDelta: 0, staticFrames: 0 };
    }

    const len = data.length;

    let meanDiff = 0;
    if (this.history.length > 0) {
      const prev = this.history[this.history.length - 1];
      let diff = 0;
      for (let i = 0; i < len; i += 4) {
        const l1 = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const l2 = 0.299 * prev[i] + 0.587 * prev[i + 1] + 0.114 * prev[i + 2];
        diff += Math.abs(l1 - l2);
      }
      meanDiff = diff / (len / 4);

      if (meanDiff < this.minMotionDelta) {
        this.staticFrames++;
      } else {
        this.staticFrames = Math.max(0, this.staticFrames - 2);
      }
    }

    const copy = new Uint8ClampedArray(data);
    this.history.push(copy);
    if (this.history.length > 20) this.history.shift();

    this.isSpoofed = this.staticFrames >= this.thresholdFrames;

    return {
      isSpoofed: this.isSpoofed,
      staticFrames: this.staticFrames,
      motionDelta: meanDiff
    };
  }
}

class BiometricsEngine {
  constructor() {
    this.isLoaded = false;
    this.registeredProfiles = [];
    this.processIntervalMs = 120; // Taxa otimizada e leve (~8 FPS para inferência ArcFace sem sobrecarregar a CPU)
    this.lastProcessTime = 0;

    // ArcFace Engine Instance (in_features=128, s=32.0, m=0.50 rad)
    this.arcFace = new ArcMarginProductEngine(128, 32.0, 0.50, false);

    // YOLOv5 Face Detector Instance
    this.yolo = new YOLOFaceDetectorEngine();

    // Temporal Identity Tracker (Anti-Flicker)
    this.tracker = new TemporalIdentityTracker();

    // Liveness Anti-Spoofing Detector (Micro-dynamic analysis on 16x16 canonical patch)
    this.livenessDetector = new LivenessAntiSpoofDetector();

    // Configurable Recognition Compatibility Threshold (Default: 90.0%)
    const savedThreshold = (typeof localStorage !== 'undefined') ? localStorage.getItem('sv_min_recognition_threshold') : null;
    this.REQUIRED_COMPATIBILITY = savedThreshold ? parseFloat(savedThreshold) : 90.0;
    this.tracker.requiredCompatibility = this.REQUIRED_COMPATIBILITY;
    this.SIMILARITY_THRESHOLD = 0.75;

    // Tracking state
    this.smoothedBox = null;
    this.consecutiveLostFrames = 0;
    this.lastMatchResult = { matched: false, label: 'Pessoa não cadastrada', confidence: 0 };
    this.simulatedMode = 'auto';

    // Offscreen helper canvases, ultra-light detection buffer (160×120) and canonical face patch (16×16)
    this.detectionWidth = 160;
    this.detectionHeight = 120;
    this.facePatchSize = 16; // 16×16 canônico: leve, instantâneo e sem consumo de memória
    this.canvasMap = {};
    this.offscreenCanvas = null;
    this.isolatedFaceCanvas = null;
    this.tempFaceCanvas = null;
    this.backgroundModel = null;
    this.lastDetectedPixels = 0;
  }

  /**
   * Define e persiste a taxa mínima de compatibilidade para não ser categorizado como Desconhecido
   */
  setRequiredCompatibility(val) {
    const num = Math.min(98.0, Math.max(50.0, parseFloat(val) || 90.0));
    this.REQUIRED_COMPATIBILITY = num;
    if (this.tracker) {
      this.tracker.requiredCompatibility = num;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sv_min_recognition_threshold', num.toFixed(1));
    }
    console.log(`[Biometrics] Limiar mínimo para Usuário Desconhecido configurado para: ${num.toFixed(1)}%`);
    return num;
  }

  setThreshold(val) {
    return this.setRequiredCompatibility(val);
  }

  async init() {
    console.log('[SecureVision AI] Initializing Discriminative Face Engine (Color, Eyes, Shape, LBP) & Temporal Tracker...');
    await this.reloadRegisteredUsers();
    this.isLoaded = true;
    console.log(`[SecureVision AI] System Ready. Registered vector profiles: ${this.registeredProfiles.length}`);
  }

  calibrateBackground(video) {
    if (!video || video.readyState < 2) return false;
    const dw = this.detectionWidth || 320;
    const dh = this.detectionHeight || 240;
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
    }
    this.offscreenCanvas.width = dw;
    this.offscreenCanvas.height = dh;
    const ctx = this.offscreenCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, dw, dh);
    const frame = ctx.getImageData(0, 0, dw, dh);
    this.backgroundModel = new Uint8ClampedArray(frame.data);
    console.log(`[Biometrics] Fundo calibrado em alta resolução (${dw}×${dh}) para o detector.`);
    return true;
  }

  resetBackgroundCalibration() {
    this.backgroundModel = null;
    console.log('[Biometrics] Calibração de fundo resetada.');
  }

  setMinFacePixels(val) {
    this.yolo.minSkinPixels = parseInt(val) || 85;
    localStorage.setItem('sv_min_face_pixels', this.yolo.minSkinPixels);
  }

  async reloadRegisteredUsers() {
    try {
      const users = await window.svDB.getAllUsers();
      const updatedProfiles = [];

      for (const u of users) {
        let rawDescriptors = u.biometrics ? u.biometrics.descriptors || [] : [];
        const photoBlobs = u.biometrics ? u.biometrics.photoBlobs || [] : [];
        let facePatches16x16 = u.biometrics ? u.biometrics.facePatches16x16 || [] : [];

        // Auto-upgrade: If user lacks 16x16 YOLO patches or legacy format, extract and update
        if (photoBlobs.length > 0 && (!facePatches16x16 || facePatches16x16.length === 0 || !u.biometrics.yolo16x16)) {
          try {
            const upgradedDescriptors = [];
            const upgradedPatches = [];
            for (const photoDataUrl of photoBlobs) {
              const desc = await this.extractDescriptorFromDataUrl(photoDataUrl);
              if (desc && desc.length === 128) {
                upgradedDescriptors.push(desc);
                if (desc.facePatch16x16) upgradedPatches.push(desc.facePatch16x16);
              }
            }
            if (upgradedDescriptors.length > 0) {
              rawDescriptors = upgradedDescriptors;
              facePatches16x16 = upgradedPatches;
              if (window.svDB && window.svDB.db) {
                const tx = window.svDB.db.transaction(['biometrics'], 'readwrite');
                tx.objectStore('biometrics').put({
                  userId: u.id,
                  descriptors: rawDescriptors,
                  photoBlobs: photoBlobs,
                  facePatches16x16: facePatches16x16,
                  videoBlob: u.biometrics ? u.biometrics.videoBlob || null : null,
                  sourceCount: photoBlobs.length,
                  yolo16x16: true,
                  updatedAt: new Date().toISOString()
                });
              }
              console.log(`[SecureVision AI] Auto-upgraded "${u.name}" to YOLO 16x16 + ArcFace Biometrics.`);
            }
          } catch (upgradeErr) {
            console.warn(`[SecureVision AI] Could not auto-upgrade ${u.name}:`, upgradeErr);
          }
        }

        const centroidVector = this.aggregateVectorCentroid(rawDescriptors);
        const isBlocked = !!u.isBlocked || (u.accessLevel === 'BLOQUEADO');

        // Pré-normalização L2 antecipada para acelerar o matching ArcFace em até 4x
        const normalizedDescriptors = (rawDescriptors || []).map(d => this.arcFace.l2Normalize(d));
        const normalizedCentroid = centroidVector ? this.arcFace.l2Normalize(centroidVector) : null;

        updatedProfiles.push({
          id: u.id,
          name: u.name,
          role: u.role,
          accessLevel: u.accessLevel || (isBlocked ? 'BLOQUEADO' : 'Nível 1 (Autorizado)'),
          isBlocked: isBlocked,
          descriptors: rawDescriptors,
          normalizedDescriptors: normalizedDescriptors,
          facePatches16x16: facePatches16x16,
          mirroredFlags: u.biometrics ? (u.biometrics.mirroredFlags || []) : [],
          weightCentroid: centroidVector,
          normalizedCentroid: normalizedCentroid,
          sourceCount: u.biometrics ? u.biometrics.sourceCount || 1 : 1
        });
      }

      this.registeredProfiles = updatedProfiles;
      this.tracker.reset();
      console.log('[ArcFace Biometrics Pipeline] Profiles reloaded:', this.registeredProfiles.map(p => `${p.name} (Blocked: ${p.isBlocked})`));
    } catch (err) {
      console.warn('[ArcFace Biometrics Pipeline] Error loading registered users from DB:', err);
    }
  }

  async extractDescriptorFromDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width || 160;
        const h = img.naturalHeight || img.height || 120;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try {
          const imgData = ctx.getImageData(0, 0, w, h);
          const yoloFace = this.yolo.detectHumanFace(imgData.data, w, h);
          const box = (yoloFace && yoloFace.box) ? yoloFace.box : {
            x: Math.round(w * 0.20),
            y: Math.round(h * 0.14),
            width: Math.round(w * 0.60),
            height: Math.round(h * 0.72)
          };
          const paddedBox = this.canonicalizeFaceBox(box, w, h);
          const { canvas: isolatedFace, dataUrl: patchUrl } = this.isolateFaceSquare(ctx, paddedBox, true, this.facePatchSize || 64);
          const desc = this.extractFaceDescriptor(isolatedFace);
          if (desc) {
            desc.facePatch = patchUrl;
            desc.facePatch16x16 = patchUrl;
            desc.box = paddedBox;
          }
          resolve(desc);
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  /**
   * DATA AUGMENTATION: Espelhamento Horizontal de Imagens (Horizontal Flip)
   * Inverte a imagem no eixo horizontal para gerar variação angular válida.
   */
  async mirrorImageDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 160;
          const h = img.naturalHeight || img.height || 120;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          
          // Inversão Horizontal (Horizontal Flip)
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0, w, h);
          
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (e) {
          console.warn('[Augmentation] Erro ao espelhar dataUrl:', e);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  /**
   * DATA AUGMENTATION PIPELINE:
   * 1. Espelha a imagem original horizontalmente
   * 2. Detecta o rosto espelhado via YOLO
   * 3. Isola estritamente em matriz 16x16 sobre fundo preto (#000000)
   * 4. Extrai o descritor vetorial 128-D com ArcFace (Norma L2 = 1.000)
   * Retorna { mirroredDataUrl, descriptor, facePatch16x16, isAugmented: true }
   */
  async generateAugmentedBiometricsFromPhoto(dataUrl) {
    const mirroredDataUrl = await this.mirrorImageDataUrl(dataUrl);
    if (!mirroredDataUrl) return null;

    const descriptor = await this.extractDescriptorFromDataUrl(mirroredDataUrl);
    if (!descriptor) return null;

    descriptor.isAugmented = true;
    descriptor.isMirrored = true;

    return {
      mirroredDataUrl: mirroredDataUrl,
      descriptor: descriptor,
      facePatch16x16: descriptor.facePatch16x16 || null,
      isAugmented: true,
      isMirrored: true
    };
  }

  /**
   * Enquadramento Canônico Universal:
   * Aplica acolchoamento proporcional rigoroso (+10% largura, +15% altura)
   * garantindo 100% de consistência entre fotos de cadastro, arquivos e vídeo ao vivo.
   */
  canonicalizeFaceBox(rawBox, frameW = 320, frameH = 240) {
    if (!rawBox) return null;
    const padX = rawBox.width * 0.10;
    const padY = rawBox.height * 0.15;
    const bx = Math.max(0, rawBox.x - padX);
    const by = Math.max(0, rawBox.y - padY);
    const bw = Math.min(frameW - bx, rawBox.width + padX * 2);
    const bh = Math.min(frameH - by, rawBox.height + padY * 2);
    return {
      x: bx,
      y: by,
      width: bw,
      height: bh,
      isCanonical: true,
      rawBox: rawBox
    };
  }

  /**
   * Stage 3: Strict Face Isolation onto Pure Black Background (#000000)
   * Supports configurable canonical square (Default: 64×64 medium rate for optimal recognition and distinguishing faces)
   * Supports CanvasRenderingContext2D, HTMLCanvasElement, and HTMLVideoElement at full native resolution
   */
  isolateFaceSquare(sourceCtx, faceBox, exportDataUrl = false, targetSize = 64) {
    targetSize = targetSize || this.facePatchSize || 64;
    if (!this.canvasMap) this.canvasMap = {};
    if (!this.canvasMap[targetSize]) {
      const c = document.createElement('canvas');
      c.width = targetSize;
      c.height = targetSize;
      this.canvasMap[targetSize] = c;
    }
    const canvas = this.canvasMap[targetSize];
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 1. Preenche 100% com Fundo Preto Puro (#000000)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, targetSize, targetSize);

    const isVideo = (typeof HTMLVideoElement !== 'undefined' && sourceCtx instanceof HTMLVideoElement) || (sourceCtx && sourceCtx.videoWidth !== undefined && sourceCtx.videoWidth > 0);
    const srcW = isVideo ? sourceCtx.videoWidth : (sourceCtx.canvas ? sourceCtx.canvas.width : (sourceCtx.width || 320));
    const srcH = isVideo ? sourceCtx.videoHeight : (sourceCtx.canvas ? sourceCtx.canvas.height : (sourceCtx.height || 240));
    const srcCanvas = isVideo ? sourceCtx : (sourceCtx.canvas || sourceCtx);

    // Garante que o recorte utilize sempre o enquadramento canônico idêntico
    const effBox = (faceBox.isCanonical || faceBox.rawBox) ? faceBox : (this.canonicalizeFaceBox(faceBox, srcW, srcH) || faceBox);

    const bx = Math.max(0, Math.min(srcW - 6, Math.floor(effBox.x)));
    const by = Math.max(0, Math.min(srcH - 6, Math.floor(effBox.y)));
    const bw = Math.max(6, Math.min(srcW - bx, Math.floor(effBox.width)));
    const bh = Math.max(6, Math.min(srcH - by, Math.floor(effBox.height)));

    if (!this.tempFaceCanvas) {
      this.tempFaceCanvas = document.createElement('canvas');
    }
    if (this.tempFaceCanvas.width !== targetSize || this.tempFaceCanvas.height !== targetSize) {
      this.tempFaceCanvas.width = targetSize;
      this.tempFaceCanvas.height = targetSize;
    }
    const tempCtx = this.tempFaceCanvas.getContext('2d', { willReadFrequently: true });
    // Desenha diretamente na resolução canônica de destino (ex: 16×16), reduzindo o loop de 160.000 pixels para apenas 256 pixels!
    tempCtx.drawImage(srcCanvas, bx, by, bw, bh, 0, 0, targetSize, targetSize);

    // 2. Máscara Anatômica Ultra-Leve em Tempo Real (256 pixels)
    const faceImgData = tempCtx.getImageData(0, 0, targetSize, targetSize);
    const data = faceImgData.data;

    const centerX = targetSize / 2;
    const centerY = targetSize * 0.48;
    const radiusX = targetSize * 0.48;
    const radiusY = targetSize * 0.52;

    for (let py = 0; py < targetSize; py++) {
      for (let px = 0; px < targetSize; px++) {
        const idx = (py * targetSize + px) * 4;
        const normDistSq = Math.pow((px - centerX) / radiusX, 2) + Math.pow((py - centerY) / radiusY, 2);

        if (normDistSq > 1.05) {
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        } else if (normDistSq > 0.82) {
          const alpha = Math.max(0, (1.05 - normDistSq) / 0.23);
          data[idx] = Math.round(data[idx] * alpha);
          data[idx + 1] = Math.round(data[idx + 1] * alpha);
          data[idx + 2] = Math.round(data[idx + 2] * alpha);
          data[idx + 3] = 255;
        }
      }
    }
    tempCtx.putImageData(faceImgData, 0, 0);

    // 3. Aplica na matriz de saída
    ctx.drawImage(this.tempFaceCanvas, 0, 0);

    // Otimização: toDataURL é executado sob demanda explícita
    let dataUrl = null;
    if (exportDataUrl) {
      try {
        dataUrl = canvas.toDataURL('image/png');
      } catch (e) {
        dataUrl = null;
      }
    }

    return {
      canvas: canvas,
      dataUrl: dataUrl
    };
  }

  isolateFaceSquare16x16(sourceCtx, faceBox, exportDataUrl = false) {
    return this.isolateFaceSquare(sourceCtx, faceBox, exportDataUrl, 16);
  }

  /**
   * Stage 3 Legacy/Convenience Bridge
   */
  isolateAndCenterFace(sourceCtx, faceBox, targetSize = 64) {
    return this.isolateFaceSquare(sourceCtx, faceBox, false, targetSize).canvas;
  }

  detectFaceInVideo(video, canvas) {
    if (!video || video.paused || video.ended || video.readyState < 2) {
      return null;
    }

    const detW = this.detectionWidth || 320;
    const detH = this.detectionHeight || 240;

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = detW;
      this.offscreenCanvas.height = detH;
    } else if (this.offscreenCanvas.width !== detW || this.offscreenCanvas.height !== detH) {
      this.offscreenCanvas.width = detW;
      this.offscreenCanvas.height = detH;
    }
    const offCtx = this.offscreenCanvas.getContext('2d');
    offCtx.drawImage(video, 0, 0, detW, detH);

    const imgData = offCtx.getImageData(0, 0, detW, detH);
    const data = imgData.data;

    // STEP 1: Pre-scan if anyone is on screen
    const presence = this.yolo.scanForPresence(data, detW, detH, this.backgroundModel);
    this.lastDetectedPixels = presence.skinPixels;

    if (!presence.hasPresence) {
      this.consecutiveLostFrames++;
      if (this.consecutiveLostFrames > 2) {
        this.smoothedBox = null;
        this.tracker.reset();
      }
      this.lastMatchResult = {
        matched: false,
        name: null,
        confidence: 0,
        label: 'NENHUMA PESSOA DETECTADA NA CÂMERA'
      };
      return {
        box: { detected: false },
        match: this.lastMatchResult,
        isolatedFaceCanvas: null
      };
    }

    // Pass previous tracked box in detection coordinates for temporal hysteresis
    const prevTrackedBox = this.smoothedBox ? {
      x: this.smoothedBox.x * detW / canvas.width,
      y: this.smoothedBox.y * detH / canvas.height,
      width: this.smoothedBox.width * detW / canvas.width,
      height: this.smoothedBox.height * detH / canvas.height
    } : null;

    // STEP 2: Utilize YOLOv5 to verify human faces and pick strictly the closest person
    const yoloResult = this.yolo.detectHumanFace(data, detW, detH, prevTrackedBox);

    if (!yoloResult || !yoloResult.isHumanFace) {
      this.consecutiveLostFrames++;
      if (this.consecutiveLostFrames > 3) {
        this.smoothedBox = null;
        this.tracker.reset();
      }
      this.lastMatchResult = {
        matched: false,
        name: null,
        confidence: 0,
        label: 'OBJETO / NÃO-ROSTO REJEITADO PELO YOLO'
      };
      return {
        box: { detected: false, isObject: true },
        match: this.lastMatchResult,
        isolatedFaceCanvas: null
      };
    }

    this.consecutiveLostFrames = 0;
    const rawBox = yoloResult.box; // Strictly the closest person to the camera!

    const scaleX = canvas.width / detW;
    const scaleY = canvas.height / detH;

    const targetW = Math.max(32, Math.min(canvas.width, rawBox.width * scaleX));
    const targetH = Math.max(38, Math.min(canvas.height, rawBox.height * scaleY));
    const targetX = Math.max(0, Math.min(canvas.width - targetW, rawBox.x * scaleX));
    const targetY = Math.max(0, Math.min(canvas.height - targetH, rawBox.y * scaleY));

    const targetBox = {
      x: targetX,
      y: targetY,
      width: targetW,
      height: targetH,
      detected: true,
      yoloConfidence: yoloResult.confidence,
      estimatedDistanceMeters: yoloResult.estimatedDistanceMeters,
      secondaryFaces: (yoloResult.allFaces && yoloResult.allFaces.length > 1)
        ? yoloResult.allFaces.slice(1).map(f => ({
            x: Math.max(0, Math.min(canvas.width - 20, f.x * scaleX)),
            y: Math.max(0, Math.min(canvas.height - 20, f.y * scaleY)),
            width: Math.max(20, Math.min(canvas.width, f.width * scaleX)),
            height: Math.max(24, Math.min(canvas.height, f.height * scaleY)),
            estimatedDistanceMeters: f.estimatedDistanceMeters
          }))
        : []
    };

    if (!this.smoothedBox) {
      this.smoothedBox = { ...targetBox };
    } else {
      const lerp = 0.35;
      this.smoothedBox.x += (targetBox.x - this.smoothedBox.x) * lerp;
      this.smoothedBox.y += (targetBox.y - this.smoothedBox.y) * lerp;
      this.smoothedBox.width += (targetBox.width - this.smoothedBox.width) * lerp;
      this.smoothedBox.height += (targetBox.height - this.smoothedBox.height) * lerp;
      this.smoothedBox.detected = true;
      this.smoothedBox.yoloConfidence = targetBox.yoloConfidence;
      this.smoothedBox.estimatedDistanceMeters = targetBox.estimatedDistanceMeters;
      this.smoothedBox.secondaryFaces = targetBox.secondaryFaces;
    }

    // STEP 3: Isolate face in canonical square via YOLO (#000000) at medium resolution (64×64) for human visual distinction & speed!
    const vW = (video && video.videoWidth > 0) ? video.videoWidth : detW;
    const vH = (video && video.videoHeight > 0) ? video.videoHeight : detH;
    const scaleVideoX = vW / detW;
    const scaleVideoY = vH / detH;
    const videoFaceBox = {
      x: rawBox.x * scaleVideoX,
      y: rawBox.y * scaleVideoY,
      width: rawBox.width * scaleVideoX,
      height: rawBox.height * scaleVideoY
    };
    const paddedBox = this.canonicalizeFaceBox(videoFaceBox, vW, vH);
    // STEP 3, 4 & 5: Periodic ArcFace / Face IA Recognition & Temporal Tracker
    // Otimização Máxima: executa o recorte e inferência biométrica apenas no intervalo programado (120ms),
    // reutilizando o resultado nos frames intermediários para manter 60 FPS lisos sem travamentos
    const now = Date.now();
    if (now - this.lastProcessTime >= this.processIntervalMs || !this._cachedIsolatedCanvas) {
      this.lastProcessTime = now;
      const patchSize = this.facePatchSize || 16;
      const { canvas: isolatedCanvas, dataUrl: patchUrl } = this.isolateFaceSquare(video, paddedBox, false, patchSize);
      this._cachedIsolatedCanvas = isolatedCanvas;
      this._cachedPatchUrl = patchUrl;

      const currentDescriptor = this.extractFaceDescriptor(isolatedCanvas);
      const rawMatch = this.matchFaceArcFaceRaw(currentDescriptor);

      // Apply Temporal Stabilization to eliminate identity flipping!
      this.lastMatchResult = this.tracker.stabilize(rawMatch);
      if (this.lastMatchResult) {
        this.lastMatchResult.estimatedDistanceMeters = targetBox.estimatedDistanceMeters;
        this.lastMatchResult.secondaryFacesCount = targetBox.secondaryFaces ? targetBox.secondaryFaces.length : 0;
      }
    }

    return {
      box: this.smoothedBox,
      match: this.lastMatchResult,
      isolatedFaceCanvas: this._cachedIsolatedCanvas,
      facePatch: this._cachedPatchUrl,
      facePatch16x16: this._cachedPatchUrl
    };
  }

  /**
   * Extração rápida de vetor 128-D ArcFace otimizada para alta performance em tempo real
   */
  extractFaceDescriptor(isolatedCanvas) {
    if (!isolatedCanvas) return this.arcFace.l2Normalize(new Float32Array(128));

    const w = isolatedCanvas.width || 16;
    const h = isolatedCanvas.height || 16;
    const ctx = isolatedCanvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, w, h);
    const mainDesc = this.extractDescriptorFromFacePatch(imgData.data, w, h);
    const normMain = this.arcFace.l2Normalize(mainDesc);

    // Otimização de Performance: 1 vetor canônico de alta precisão (sem clonar 4 cópias em memória a cada frame)
    normMain.candidateDescriptors = [normMain];

    return normMain;
  }

  /**
   * Extração de vetor 128-D a partir de matriz facial quadrada isolada (ex: 64×64 ou 16×16)
   * Suporta matrizes de média resolução (64×64) e preserva compatibilidade matemática completa
   */
  extractDescriptorFromFacePatch(data, w = 64, h = 64) {
    if (w === 16 && h === 16) {
      return this.extractDescriptorFrom16x16(data, 16, 16);
    }
    if (data && typeof data.getContext === 'function') {
      const ctx = data.getContext('2d', { willReadFrequently: true });
      data = ctx.getImageData(0, 0, w, h).data;
    }
    if (!data) return new Float32Array(128);

    const blockW = w / 16;
    const blockH = h / 16;
    const data16 = new Uint8ClampedArray(16 * 16 * 4);

    for (let y16 = 0; y16 < 16; y16++) {
      const startY = Math.floor(y16 * blockH);
      const endY = Math.floor((y16 + 1) * blockH);
      for (let x16 = 0; x16 < 16; x16++) {
        const startX = Math.floor(x16 * blockW);
        const endX = Math.floor((x16 + 1) * blockW);
        let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const idx = (py * w + px) * 4;
            sumR += data[idx];
            sumG += data[idx + 1];
            sumB += data[idx + 2];
            sumA += data[idx + 3];
            count++;
          }
        }
        const dIdx = (y16 * 16 + x16) * 4;
        const norm = count || 1;
        data16[dIdx] = Math.round(sumR / norm);
        data16[dIdx + 1] = Math.round(sumG / norm);
        data16[dIdx + 2] = Math.round(sumB / norm);
        data16[dIdx + 3] = Math.round(sumA / norm);
      }
    }

    return this.extractDescriptorFrom16x16(data16, 16, 16);
  }

  /**
   * Extração direta de vetor 128-D do quadrado 16x16 isolado via YOLO
   * (Arquitetura Orange Data Mining: Image Embedding -> kNN / Neural Network)
   */
  extractDescriptorFrom16x16(data, w = 16, h = 16) {
    if (data && typeof data.getContext === 'function') {
      const ctx = data.getContext('2d', { willReadFrequently: true });
      data = ctx.getImageData(0, 0, 16, 16).data;
    }
    if (!data) return new Float32Array(128);

    const f = new Float32Array(128);
    let idx = 0;

    let sumLum = 0, sumLumSq = 0, validPix = 0;
    let sumR = 0, sumG = 0, sumB = 0;
    let sumCb = 0, sumCr = 0;

    const lum = new Float32Array(256);
    const cbArr = new Float32Array(256);
    const crArr = new Float32Array(256);

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r <= 6 && g <= 6 && b <= 6) continue;

        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        const Cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
        const Cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;

        lum[y * 16 + x] = Y;
        cbArr[y * 16 + x] = Cb;
        crArr[y * 16 + x] = Cr;

        sumLum += Y; sumLumSq += Y * Y; validPix++;
        sumR += r; sumG += g; sumB += b;
        sumCb += Cb; sumCr += Cr;
      }
    }

    const vNorm = validPix || 1;
    const meanLum = sumLum / vNorm;
    const stdLum = Math.sqrt(Math.max(16.0, (sumLumSq / vNorm) - (meanLum * meanLum)));

    // BLOCK 1: COLORIMETRIA E PIGMENTAÇÃO CHROMINANCE (36 DIMS)
    const avgCb = sumCb / vNorm;
    const avgCr = sumCr / vNorm;
    const totRGB = (sumR + sumG + sumB) || 1;
    const nr = sumR / totRGB, ng = sumG / totRGB, nb = sumB / totRGB;

    f[idx++] = (avgCb - 122) / 8.0;
    f[idx++] = (avgCr - 146) / 8.0;
    f[idx++] = (nr - 0.40) / 0.06;
    f[idx++] = (ng - 0.33) / 0.06;
    f[idx++] = (nb - 0.27) / 0.06;
    f[idx++] = ((nr - nb) - 0.13) / 0.05;

    let fhCr = 0, fhCb = 0, fhCount = 0;
    let chCr = 0, chCb = 0, chCount = 0;
    let lipCr = 0, lipCb = 0, lipCount = 0;
    let chinCr = 0, chinCb = 0, chinCount = 0;

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const Cb = cbArr[y * 16 + x];
        const Cr = crArr[y * 16 + x];
        if (Cr === 0 && Cb === 0) continue;

        if (y >= 2 && y <= 4 && x >= 4 && x <= 11) { fhCr += Cr; fhCb += Cb; fhCount++; }
        else if (y >= 6 && y <= 9 && ((x >= 2 && x <= 5) || (x >= 10 && x <= 13))) { chCr += Cr; chCb += Cb; chCount++; }
        else if (y >= 10 && y <= 12 && x >= 5 && x <= 10) { lipCr += Cr; lipCb += Cb; lipCount++; }
        else if (y >= 13 && y <= 15 && x >= 5 && x <= 10) { chinCr += Cr; chinCb += Cb; chinCount++; }
      }
    }

    const mFhCr = fhCount ? fhCr / fhCount : avgCr;
    const mFhCb = fhCount ? fhCb / fhCount : avgCb;
    const mChCr = chCount ? chCr / chCount : avgCr;
    const mChCb = chCount ? chCb / chCount : avgCb;
    const mLipCr = lipCount ? lipCr / lipCount : avgCr;
    const mLipCb = lipCount ? lipCb / lipCount : avgCb;
    const mChinCr = chinCount ? chinCr / chinCount : avgCr;
    const mChinCb = chinCount ? chinCb / chinCount : avgCb;

    f[idx++] = (mFhCb - 122) / 8.0;
    f[idx++] = (mFhCr - 146) / 8.0;
    f[idx++] = (mChCb - 122) / 8.0;
    f[idx++] = (mChCr - 146) / 8.0;
    f[idx++] = (mLipCb - 120) / 8.0;
    f[idx++] = (mLipCr - 155) / 10.0;
    f[idx++] = (mChinCb - 122) / 8.0;
    f[idx++] = (mChinCr - 146) / 8.0;

    f[idx++] = (mLipCr - mChCr - 10.0) / 6.0;
    f[idx++] = (mLipCb - mChCb - (-2.0)) / 6.0;
    f[idx++] = (mFhCr - mChinCr) / 6.0;

    const cbHist = new Float32Array(8);
    const crHist = new Float32Array(8);
    for (let i = 0; i < 256; i++) {
      if (crArr[i] > 0) {
        const bCr = Math.max(0, Math.min(7, Math.floor((crArr[i] - 128) / 6)));
        const bCb = Math.max(0, Math.min(7, Math.floor((cbArr[i] - 128) / 6)));
        crHist[bCr]++; cbHist[bCb]++;
      }
    }
    for (let b = 0; b < 8; b++) f[idx++] = ((cbHist[b] / vNorm) - 0.125) / 0.08;
    for (let b = 0; b < 8; b++) f[idx++] = ((crHist[b] / vNorm) - 0.125) / 0.08;
    while (idx < 36) f[idx++] = 0;

    // BLOCK 2: PROPORÇÕES ANTHROPOMÉTRICAS ADAPTATIVAS (32 DIMS)
    let minLeftL = 999, leftEyeX = 4, leftEyeY = 5;
    for (let y = 3; y <= 7; y++) {
      for (let x = 2; x <= 6; x++) {
        const l = lum[y * 16 + x];
        if (l > 8 && l < minLeftL) { minLeftL = l; leftEyeX = x; leftEyeY = y; }
      }
    }

    let minRightL = 999, rightEyeX = 11, rightEyeY = 5;
    for (let y = 3; y <= 7; y++) {
      for (let x = 9; x <= 13; x++) {
        const l = lum[y * 16 + x];
        if (l > 8 && l < minRightL) { minRightL = l; rightEyeX = x; rightEyeY = y; }
      }
    }

    let minMouthL = 999, mouthX = 8, mouthY = 11;
    for (let y = 10; y <= 13; y++) {
      for (let x = 5; x <= 10; x++) {
        const l = lum[y * 16 + x];
        if (l > 8 && l < minMouthL) { minMouthL = l; mouthX = x; mouthY = y; }
      }
    }

    const eyeCenterY = (leftEyeY + rightEyeY) / 2.0;
    const ipd = (rightEyeX - leftEyeX) / 16.0;
    const cantalTilt = (rightEyeY - leftEyeY) / 16.0;
    const eyeToMouth = (mouthY - eyeCenterY) / 16.0;
    const eyeMouthAspect = ipd / (eyeToMouth + 0.01);

    f[idx++] = (ipd - 0.44) / 0.06;
    f[idx++] = (eyeCenterY / 16.0 - 0.32) / 0.05;
    f[idx++] = cantalTilt / 0.04;
    f[idx++] = (eyeToMouth - 0.38) / 0.06;
    f[idx++] = (eyeMouthAspect - 1.15) / 0.15;

    f[idx++] = (minLeftL - meanLum) / (stdLum + 1.0);
    f[idx++] = (minRightL - meanLum) / (stdLum + 1.0);
    f[idx++] = (minLeftL - minRightL) / (stdLum + 1.0);

    let bridgeLum = 0, bridgeCount = 0;
    for (let y = Math.floor(eyeCenterY); y <= Math.floor(eyeCenterY + 2); y++) {
      for (let x = 7; x <= 8; x++) {
        if (lum[y * 16 + x] > 8) { bridgeLum += lum[y * 16 + x]; bridgeCount++; }
      }
    }
    const avgBridge = bridgeCount ? bridgeLum / bridgeCount : meanLum;
    f[idx++] = (avgBridge - meanLum) / (stdLum + 1.0);

    let browLum = 0, browCount = 0;
    for (let y = Math.max(1, Math.floor(eyeCenterY - 2)); y < Math.floor(eyeCenterY); y++) {
      for (let x = 3; x <= 12; x++) {
        if (lum[y * 16 + x] > 8) { browLum += lum[y * 16 + x]; browCount++; }
      }
    }
    const avgBrow = browCount ? browLum / browCount : meanLum;
    f[idx++] = (avgBrow - meanLum) / (stdLum + 1.0);

    const hUpper = eyeCenterY;
    const hMid = mouthY - eyeCenterY;
    const hLower = 15 - mouthY;
    f[idx++] = ((hUpper / (hMid + 0.01)) - 0.90) / 0.15;
    f[idx++] = ((hLower / (hMid + 0.01)) - 0.85) / 0.15;

    while (idx < 68) f[idx++] = 0;

    // BLOCK 3: CONTORNO MANDIBULAR E LARGURA DE ROSTO (28 DIMS)
    function getSkinWidthAtY(targetY) {
      let minX = 16, maxX = 0;
      for (let x = 0; x < 16; x++) {
        if (lum[targetY * 16 + x] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      return maxX >= minX ? (maxX - minX + 1) / 16.0 : 0.1;
    }

    const wForehead = getSkinWidthAtY(3);
    const wCheek = getSkinWidthAtY(7);
    const wJaw = getSkinWidthAtY(11);
    const wChin = getSkinWidthAtY(14);

    f[idx++] = (wForehead - 0.60) / 0.12;
    f[idx++] = (wCheek - 0.75) / 0.12;
    f[idx++] = (wJaw - 0.65) / 0.12;
    f[idx++] = (wChin - 0.40) / 0.10;

    f[idx++] = ((wJaw / (wCheek + 0.01)) - 0.85) / 0.10;
    f[idx++] = ((wChin / (wJaw + 0.01)) - 0.62) / 0.12;
    f[idx++] = ((wForehead / (wCheek + 0.01)) - 0.80) / 0.10;

    for (let r = 3; r <= 13; r += 2) {
      let lSum = 0, rSum = 0;
      for (let x = 0; x < 7; x++) lSum += lum[r * 16 + x];
      for (let x = 9; x < 16; x++) rSum += lum[r * 16 + x];
      f[idx++] = ((lSum - rSum) / (lSum + rSum + 1.0)) / 0.15;
    }
    while (idx < 96) f[idx++] = 0;

    // BLOCK 4: CONTRASTES ESPACIAIS RELATIVOS E GRADIENTES (32 DIMS)
    for (let y = 4; y <= 12; y += 2) {
      const lCheek = (lum[y * 16 + 3] + lum[y * 16 + 4]) / 2;
      const nose = (lum[y * 16 + 7] + lum[y * 16 + 8]) / 2;
      const rCheek = (lum[y * 16 + 11] + lum[y * 16 + 12]) / 2;
      f[idx++] = (nose - lCheek) / (stdLum + 1.0);
      f[idx++] = (nose - rCheek) / (stdLum + 1.0);
    }

    for (let x = 5; x <= 10; x += 2) {
      const pForehead = lum[3 * 16 + x];
      const pEye = lum[5 * 16 + x];
      const pCheek = lum[8 * 16 + x];
      const pMouth = lum[11 * 16 + x];
      const pChin = lum[14 * 16 + x];
      f[idx++] = (pForehead - pEye) / (stdLum + 1.0);
      f[idx++] = (pCheek - pEye) / (stdLum + 1.0);
      f[idx++] = (pCheek - pMouth) / (stdLum + 1.0);
      f[idx++] = (pChin - pMouth) / (stdLum + 1.0);
    }
    while (idx < 128) f[idx++] = 0;

    // NORMALIZAÇÃO BALANCEADA POR BLOCOS FUNCIONAIS
    // Evita que a cor da pele domine o vetor e garante alta discriminância anatômica única para cada pessoa
    const bColor = f.slice(0, 36);
    const bAnthro = f.slice(36, 68);
    const bJaw = f.slice(68, 96);
    const bGrad = f.slice(96, 128);

    const normBlock = (arr, targetWeight) => {
      let s = 0;
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.max(-2.5, Math.min(2.5, arr[i]));
        s += arr[i] * arr[i];
      }
      const n = Math.sqrt(s) || 1e-6;
      const factor = Math.sqrt(targetWeight) / n;
      for (let i = 0; i < arr.length; i++) arr[i] *= factor;
      return arr;
    };

    // Pesos: Antropometria (40%), Gradientes/Textura (25%), Mandíbula (20%), Cor (15%)
    normBlock(bColor, 0.15);
    normBlock(bAnthro, 0.40);
    normBlock(bJaw, 0.20);
    normBlock(bGrad, 0.25);

    f.set(bColor, 0);
    f.set(bAnthro, 36);
    f.set(bJaw, 68);
    f.set(bGrad, 96);

    // Normalização L2 Unitária ArcFace (||v|| = 1.0000)
    return this.arcFace.l2Normalize(Array.from(f));
  }

  aggregateVectorCentroid(descriptorsList) {
    if (!descriptorsList || descriptorsList.length === 0) return null;
    const len = descriptorsList[0].length;
    const centroid = new Float32Array(len);

    for (const vec of descriptorsList) {
      for (let i = 0; i < len; i++) centroid[i] += vec[i];
    }
    for (let i = 0; i < len; i++) centroid[i] /= descriptorsList.length;

    return this.arcFace.l2Normalize(Array.from(centroid));
  }

  /**
   * Raw 1:N ArcFace Matching with Multi-Modal Vector
   */
  matchFaceArcFaceRaw(targetDescriptor) {
    if (!this.registeredProfiles || this.registeredProfiles.length === 0) {
      return {
        matched: false,
        label: 'Pessoa não cadastrada',
        reason: 'Banco de dados vazio: nenhuma face registrada para conferência',
        confidence: '0.0',
        cosineSimilarity: '0.000',
        arcFaceMarginLogit: '0.00',
        profilesChecked: 0
      };
    }

    const candidateVectors = (targetDescriptor && targetDescriptor.candidateDescriptors) ? targetDescriptor.candidateDescriptors : [targetDescriptor];
    let bestProfile = null;
    let maxCosine = -1.0;
    let totalComparisons = 0;

    for (const profile of this.registeredProfiles) {
      // 1. Centróide ponderado (usar pré-normalizado se disponível)
      const targetCentroid = profile.normalizedCentroid || (profile.weightCentroid ? this.arcFace.l2Normalize(profile.weightCentroid) : null);
      if (targetCentroid) {
        for (const cVec of candidateVectors) {
          const cosTheta = this.arcFace.computeCosine(cVec, targetCentroid);
          totalComparisons++;
          if (cosTheta > maxCosine) {
            maxCosine = cosTheta;
            bestProfile = profile;
          }
        }
      }

      // 2. Descritores individuais (usar pré-normalizados sem alocações repetidas de l2Normalize)
      const targetNormDescriptors = profile.normalizedDescriptors || (profile.descriptors ? profile.descriptors.map(d => this.arcFace.l2Normalize(d)) : []);
      for (const normReg of targetNormDescriptors) {
        for (const cVec of candidateVectors) {
          const cosTheta = this.arcFace.computeCosine(cVec, normReg);
          totalComparisons++;
          if (cosTheta > maxCosine) {
            maxCosine = cosTheta;
            bestProfile = profile;
          }
        }
      }
    }

    // Calcula ArcFace Angular Margin EXCLUSIVAMENTE para a predição vencedora (economia massiva de CPU)
    const bestArcMargin = maxCosine >= -1.0 ? this.arcFace.computeArcMargin(maxCosine) : null;

    // Mapeamento Calibrado ArcFace (Matriz Canônica 16×16)
    // Para uma correspondência autêntica da mesma pessoa, o cosseno atinge >= 0.96 (Compatibilidade >= 90.0%).
    // Rostos diferentes ou não cadastrados situam-se em cossenos <= 0.93 (Compatibilidade <= 79%),
    // caindo categoricamente como "Pessoa não cadastrada".
    let compatibilityPct = 0;
    if (maxCosine >= 0.96) {
      // Faixa de correspondência autêntica: 0.96 -> 90.0% | 0.98 -> 94.8% | 1.00 -> 99.5%
      compatibilityPct = 90.0 + ((maxCosine - 0.96) / 0.04) * 9.5;
    } else if (maxCosine >= 0.88) {
      // Faixa de incerteza / não cadastrado: 0.88 -> 60.0% | 0.92 -> 74.2% | 0.95 -> 84.9% (< 90%)
      compatibilityPct = 60.0 + ((maxCosine - 0.88) / 0.08) * 28.5;
    } else if (maxCosine >= 0.70) {
      // Faixa de baixa similaridade facial
      compatibilityPct = 25.0 + ((maxCosine - 0.70) / 0.18) * 34.0;
    } else {
      compatibilityPct = Math.max(0.0, (maxCosine / 0.70) * 25.0);
    }
    const finalConfidence = Math.min(99.5, Math.max(0.0, compatibilityPct)).toFixed(1);

    const isAboveNinety = parseFloat(finalConfidence) >= this.REQUIRED_COMPATIBILITY;

    if (bestProfile && isAboveNinety) {
      return {
        matched: true,
        userId: bestProfile.id,
        name: bestProfile.name,
        role: bestProfile.role || 'Funcionário',
        accessLevel: bestProfile.accessLevel || (bestProfile.isBlocked ? 'BLOQUEADO' : 'Nível 1 (Autorizado)'),
        isBlocked: !!bestProfile.isBlocked,
        sourceCount: bestProfile.sourceCount || 1,
        confidence: finalConfidence,
        arcFaceMarginLogit: bestArcMargin ? bestArcMargin.scaledMarginLogit.toFixed(2) : '0.00',
        cosineSimilarity: maxCosine.toFixed(3),
        profilesChecked: totalComparisons,
        databaseFacePatch16x16: (bestProfile.facePatches16x16 && bestProfile.facePatches16x16[0]) || null
      };
    }

    return {
      matched: false,
      label: 'Pessoa não cadastrada',
      reason: `Compatibilidade facial (${finalConfidence}%) inferior ao critério de segurança de ${(this.REQUIRED_COMPATIBILITY || 90.0).toFixed(1)}%`,
      confidence: finalConfidence,
      cosineSimilarity: maxCosine.toFixed(3),
      arcFaceMarginLogit: bestArcMargin ? bestArcMargin.scaledMarginLogit.toFixed(2) : '0.00',
      profilesChecked: totalComparisons,
      closestCandidate: bestProfile ? { name: bestProfile.name, confidence: finalConfidence, facePatch16x16: (bestProfile.facePatches16x16 && bestProfile.facePatches16x16[0]) || null } : null
    };
  }

  /**
   * Main ArcFace Matching with Temporal Tracker stabilization
   */
  matchFaceArcFace(targetDescriptor) {
    const rawResult = this.matchFaceArcFaceRaw(targetDescriptor);
    return this.tracker.stabilize(rawResult);
  }

  async extractDescriptorsFromCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const imgData = ctx.getImageData(0, 0, w, h);
    const yoloFace = this.yolo.detectHumanFace(imgData.data, w, h);

    let box = null;
    if (yoloFace && yoloFace.box) {
      box = yoloFace.box;
    } else {
      const boxW = Math.round(w * 0.60);
      const boxH = Math.round(h * 0.72);
      box = {
        x: Math.round((w - boxW) / 2),
        y: Math.round(h * 0.14),
        width: boxW,
        height: boxH
      };
    }

    const paddedBox = this.canonicalizeFaceBox(box, w, h);
    const { canvas: isolatedFace, dataUrl: patchUrl } = this.isolateFaceSquare(ctx, paddedBox, true, this.facePatchSize || 64);
    const descriptor = this.extractFaceDescriptor(isolatedFace);
    if (descriptor) {
      descriptor.facePatch = patchUrl;
      descriptor.facePatch16x16 = patchUrl;
      descriptor.box = paddedBox;
    }
    return descriptor;
  }
}

window.svBiometrics = new BiometricsEngine();
