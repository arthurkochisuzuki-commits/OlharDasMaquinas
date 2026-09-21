"""
SecureVision AI - Biometric Engine Architecture
================================================
Senior Computer Vision & AI Architecture Pipeline

Multi-modal biometric extraction engine:
1. Deep Structural Feature Extraction: ArcFace (MobileFaceNet / ResNet) ONNX 512-D.
2. Canonical 2D Affine Similarity Alignment via 5 anatomical facial landmarks.
3. Illumination-Compensated Skin Chromaticity & Micro-Texture Analysis (CIE-L*a*b* + Uniform LBP).
4. Ear Biometrics (Otomorphology / Bilateral ROIs with HOG & Geometric Aspect Ratios).
5. Weighted Multimodal Fusion (707-D Unit L2 Vector) for sub-millisecond FAISS vector search.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union
import math
import os
import time

import cv2
import numpy as np
import onnxruntime as ort

# ==============================================================================
# 1. CONSTANTS & ANATOMICAL REFERENCE SPECIFICATIONS
# ==============================================================================

ARCFACE_REFERENCE_5PTS = np.array([
    [38.2946, 51.6963],  # Eye 1 (viewer's left)
    [73.5318, 51.5014],  # Eye 2 (viewer's right)
    [56.0252, 71.7366],  # Nose tip
    [41.5493, 92.3655],  # Mouth corner 1
    [70.7299, 92.2041]   # Mouth corner 2
], dtype=np.float32)

DEFAULT_ARCFACE_MODEL = 'models/w600k_mbf.onnx'
DEFAULT_YUNET_MODEL = 'models/face_detection_yunet_2023mar.onnx'


@dataclass
class BiometricProfile:
    """Complete mathematical biometric profile for an identity."""
    person_id: str
    name: str
    arcface_vector: np.ndarray          # 512-D L2-normalized vector
    skin_vector: np.ndarray              # 123-D L2-normalized vector
    ear_vector: np.ndarray               # 72-D L2-normalized vector
    fused_vector: np.ndarray             # 707-D L2-normalized unified vector
    ear_visible: bool                    # Whether ear was visible or occluded
    quality_score: float                 # Overall face quality assessment [0.0 - 1.0]
    bbox: Tuple[int, int, int, int]      # (x, y, w, h)
    landmarks: np.ndarray                # 5x2 landmarks
    metadata: Dict[str, Union[str, float, int]] = field(default_factory=dict)


# ==============================================================================
# 2. FACE DETECTION & ALIGNMENT (OpenCV YuNet + Affine Similarity Warper)
# ==============================================================================

class FaceDetector:
    """
    High-performance neural face detector using OpenCV YuNet DNN.
    Extracts face bounding box and 5 facial landmarks at 60+ FPS on CPU.
    """

    def __init__(self, model_path: str = DEFAULT_YUNET_MODEL, conf_threshold: float = 0.45, nms_threshold: float = 0.3):
        self.model_path = model_path
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        self.detector = None
        self._current_input_size = (320, 320)
        self._init_detector()

    def _init_detector(self):
        if os.path.exists(self.model_path):
            try:
                self.detector = cv2.FaceDetectorYN.create(
                    model=self.model_path,
                    config='',
                    input_size=self._current_input_size,
                    score_threshold=self.conf_threshold,
                    nms_threshold=self.nms_threshold,
                    top_k=5000,
                    backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
                    target_id=cv2.dnn.DNN_TARGET_CPU
                )
            except Exception as e:
                print(f'[FaceDetector] Error initializing YuNet: {e}')
                self.detector = None
        else:
            self.detector = None

    def detect(self, image: np.ndarray) -> List[Dict[str, Union[np.ndarray, float, Tuple[int, int, int, int]]]]:
        if self.detector is None:
            return []

        h, w = image.shape[:2]
        if (w, h) != self._current_input_size:
            self._current_input_size = (w, h)
            self.detector.setInputSize((w, h))

        _, faces = self.detector.detect(image)

        # Sensitive second-pass if no face found initially
        if faces is None or len(faces) == 0:
            self.detector.setScoreThreshold(self.conf_threshold * 0.70)
            _, faces = self.detector.detect(image)
            self.detector.setScoreThreshold(self.conf_threshold)

        results = []
        if faces is not None and len(faces) > 0:
            for face in faces:
                x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
                score = float(face[-1])
                landmarks = face[4:14].reshape((5, 2)).astype(np.float32)
                results.append({
                    'bbox': (x, y, fw, fh),
                    'landmarks': landmarks,
                    'confidence': score
                })
        return results

    @staticmethod
    def align_face_canonical(image: np.ndarray, landmarks: np.ndarray, output_size: Tuple[int, int] = (112, 112)) -> np.ndarray:
        m, inliers = cv2.estimateAffinePartial2D(landmarks, ARCFACE_REFERENCE_5PTS)
        if m is None:
            center = np.mean(landmarks, axis=0)
            x0 = max(0, int(center[0] - 56))
            y0 = max(0, int(center[1] - 56))
            crop = image[y0:y0 + 112, x0:x0 + 112]
            if crop.size == 0 or crop.shape[0] < 10 or crop.shape[1] < 10:
                return cv2.resize(image, output_size)
            return cv2.resize(crop, output_size)
        
        warped = cv2.warpAffine(image, m, output_size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        return warped


# ==============================================================================
# 3. DEEP STRUCTURAL FEATURE EXTRACTION (ArcFace 512-D ONNX)
# ==============================================================================

class ArcFaceEmbeddingExtractor:
    """
    ArcFace Deep Feature Extractor powered by ONNXRuntime.
    Input: Aligned Canonical face (112x112x3)
    Output: 512-D L2-normalized feature vector.
    """

    def __init__(self, model_path: str = DEFAULT_ARCFACE_MODEL):
        self.model_path = model_path
        self.session = None
        self.input_name = None
        self._init_session()

    def _init_session(self):
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f'ArcFace model not found at {self.model_path}')
        
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) // 2)

        self.session = ort.InferenceSession(self.model_path, sess_options=opts, providers=['CPUExecutionProvider'])
        self.input_name = self.session.get_inputs()[0].name

    def extract(self, aligned_face_bgr: np.ndarray) -> np.ndarray:
        rgb = cv2.cvtColor(aligned_face_bgr, cv2.COLOR_BGR2RGB)
        tensor = (rgb.astype(np.float32) - 127.5) / 128.0
        tensor = np.transpose(tensor, (2, 0, 1))
        tensor = np.expand_dims(tensor, axis=0)

        outputs = self.session.run(None, {self.input_name: tensor})
        raw_vector = outputs[0].flatten().astype(np.float32)

        norm = np.linalg.norm(raw_vector)
        if norm > 1e-10:
            return raw_vector / norm
        return raw_vector


# ==============================================================================
# 4. ILLUMINATION-COMPENSATED SKIN COLOR & TEXTURE BIOMETRICS
# ==============================================================================

class SkinBiometricExtractor:
    """
    Physical Skin Biometrics with Illumination Invariance:
    1. Epidermal Mask-guided Gray-World Retinex & CLAHE.
    2. Soft Gaussian-smoothed CIE-L*a*b* Chromaticity (60-D).
    3. Chromaticity Statistical Moments (4-D: mean_a, std_a, mean_b, std_b).
    4. Uniform Local Binary Pattern (LBP) Texture (59-D).
    Total Output: 123-D L2-normalized feature vector.
    """

    def __init__(self):
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

    @staticmethod
    def create_epidermal_mask(h: int = 112, w: int = 112) -> np.ndarray:
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.rectangle(mask, (int(w * 0.22), int(h * 0.12)), (int(w * 0.78), int(h * 0.32)), 255, -1)
        cv2.ellipse(mask, (int(w * 0.26), int(h * 0.65)), (int(w * 0.14), int(h * 0.18)), 0, 0, 360, 255, -1)
        cv2.ellipse(mask, (int(w * 0.74), int(h * 0.65)), (int(w * 0.14), int(h * 0.18)), 0, 0, 360, 255, -1)
        cv2.rectangle(mask, (int(w * 0.35), int(h * 0.86)), (int(w * 0.65), int(h * 0.98)), 255, -1)

        cv2.ellipse(mask, (int(w * 0.34), int(h * 0.46)), (int(w * 0.12), int(h * 0.08)), 0, 0, 360, 0, -1)
        cv2.ellipse(mask, (int(w * 0.66), int(h * 0.46)), (int(w * 0.12), int(h * 0.08)), 0, 0, 360, 0, -1)
        cv2.ellipse(mask, (int(w * 0.50), int(h * 0.82)), (int(w * 0.18), int(h * 0.10)), 0, 0, 360, 0, -1)
        return mask

    def compensate_illumination(self, bgr_face: np.ndarray, mask: np.ndarray) -> np.ndarray:
        img_f = bgr_face.astype(np.float32)
        if np.count_nonzero(mask) > 50:
            pixels = img_f[mask > 0]
            mean_b = np.mean(pixels[:, 0]) + 1e-6
            mean_g = np.mean(pixels[:, 1]) + 1e-6
            mean_r = np.mean(pixels[:, 2]) + 1e-6
        else:
            mean_b = np.mean(img_f[:, :, 0]) + 1e-6
            mean_g = np.mean(img_f[:, :, 1]) + 1e-6
            mean_r = np.mean(img_f[:, :, 2]) + 1e-6

        mean_gray = (mean_b + mean_g + mean_r) / 3.0

        balanced = np.zeros_like(img_f)
        balanced[:, :, 0] = np.clip(img_f[:, :, 0] * (mean_gray / mean_b), 0, 255)
        balanced[:, :, 1] = np.clip(img_f[:, :, 1] * (mean_gray / mean_g), 0, 255)
        balanced[:, :, 2] = np.clip(img_f[:, :, 2] * (mean_gray / mean_r), 0, 255)
        return balanced.astype(np.uint8)

    @staticmethod
    def compute_uniform_lbp(gray_img: np.ndarray, mask: np.ndarray) -> np.ndarray:
        padded = np.pad(gray_img, 1, mode='reflect')
        c = padded[1:-1, 1:-1]
        n0 = padded[1:-1, 2:] >= c
        n1 = padded[:-2, 2:] >= c
        n2 = padded[:-2, 1:-1] >= c
        n3 = padded[:-2, :-2] >= c
        n4 = padded[1:-1, :-2] >= c
        n5 = padded[2:, :-2] >= c
        n6 = padded[2:, 1:-1] >= c
        n7 = padded[2:, 2:] >= c

        code = (n0 * 1 + n1 * 2 + n2 * 4 + n3 * 8 + n4 * 16 + n5 * 32 + n6 * 64 + n7 * 128).astype(np.uint8)

        lut = np.full(256, 58, dtype=np.int32)
        uniform_idx = 0
        for i in range(256):
            binary_str = f'{i:08b}'
            transitions = sum(binary_str[j] != binary_str[(j + 1) % 8] for j in range(8))
            if transitions <= 2:
                lut[i] = uniform_idx
                uniform_idx += 1

        mapped = lut[code]
        valid_codes = mapped[mask > 0]
        if len(valid_codes) == 0:
            return np.zeros(59, dtype=np.float32)
        
        hist, _ = np.histogram(valid_codes, bins=59, range=(0, 59))
        hist = hist.astype(np.float32)
        hist /= (np.sum(hist) + 1e-6)
        return hist

    def extract(self, aligned_face_bgr: np.ndarray) -> np.ndarray:
        h, w = aligned_face_bgr.shape[:2]
        mask = self.create_epidermal_mask(h, w)
        balanced_bgr = self.compensate_illumination(aligned_face_bgr, mask)

        lab = cv2.cvtColor(balanced_bgr, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        l_eq = self.clahe.apply(l)

        a_skin = a[mask > 0]
        b_skin = b[mask > 0]

        if len(a_skin) > 0:
            hist_ab, _, _ = np.histogram2d(a_skin, b_skin, bins=[8, 8], range=[[100, 165], [100, 170]])
            hist_ab = cv2.GaussianBlur(hist_ab.astype(np.float32), (3, 3), 0.8)
            chroma_flat = hist_ab.flatten()
            if np.sum(chroma_flat) > 0:
                chroma_flat /= np.sum(chroma_flat)
            chroma_60 = chroma_flat[:60]

            ma = float(np.mean(a_skin)) / 255.0
            sa = float(np.std(a_skin)) / 50.0
            mb = float(np.mean(b_skin)) / 255.0
            sb = float(np.std(b_skin)) / 50.0
            moments_4 = np.array([ma, sa, mb, sb], dtype=np.float32)
        else:
            chroma_60 = np.zeros(60, dtype=np.float32)
            moments_4 = np.zeros(4, dtype=np.float32)

        gray = cv2.cvtColor(balanced_bgr, cv2.COLOR_BGR2GRAY)
        texture_vec = self.compute_uniform_lbp(gray, mask)

        combined = np.concatenate([chroma_60, moments_4, texture_vec])
        norm = np.linalg.norm(combined)
        if norm > 1e-10:
            return combined / norm
        return combined


# ==============================================================================
# 5. EAR BIOMETRICS (Otomorphology / Bilateral ROIs with HOG & Geometry)
# ==============================================================================

class EarBiometricExtractor:
    """
    Ear Biometrics Extractor (Otomorphology):
    1. Bilateral Anatomical ROI Projection.
    2. Visibility / Occlusion Verification.
    3. Vectorized HOG descriptor (64-D).
    4. Geometric Aspect Ratios (8-D).
    Total Output: 72-D L2-normalized feature vector + visibility flag.
    """

    def extract_rois(self, image: np.ndarray, bbox: Tuple[int, int, int, int], landmarks: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
        img_h, img_w = image.shape[:2]
        x, y, w, h = bbox
        eye_l, eye_r = landmarks[0], landmarks[1]

        ear_w = int(w * 0.35)
        ear_h = int(h * 0.55)
        y_start = max(0, int(min(eye_l[1], eye_r[1]) - h * 0.15))
        y_end = min(img_h, y_start + ear_h)

        left_x_end = max(0, int(x + w * 0.10))
        left_x_start = max(0, left_x_end - ear_w)
        left_ear_roi = image[y_start:y_end, left_x_start:left_x_end] if (left_x_end > left_x_start and y_end > y_start) else None

        right_x_start = min(img_w, int(x + w * 0.90))
        right_x_end = min(img_w, right_x_start + ear_w)
        right_ear_roi = image[y_start:y_end, right_x_start:right_x_end] if (right_x_end > right_x_start and y_end > y_start) else None

        return left_ear_roi, right_ear_roi

    @staticmethod
    def _is_ear_visible(roi: Optional[np.ndarray]) -> bool:
        if roi is None or roi.size < 400 or roi.shape[0] < 15 or roi.shape[1] < 10:
            return False

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 40, 120)
        edge_ratio = np.count_nonzero(edges) / edges.size

        ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
        cr, cb = ycrcb[:, :, 1], ycrcb[:, :, 2]
        skin_pixels = np.count_nonzero((cr >= 133) & (cr <= 173) & (cb >= 77) & (cb <= 127))
        skin_ratio = skin_pixels / (roi.shape[0] * roi.shape[1])

        return (skin_ratio >= 0.20) and (0.03 <= edge_ratio <= 0.45)

    @staticmethod
    def compute_ear_hog_64d(gray_32x64: np.ndarray) -> np.ndarray:
        gx = cv2.Sobel(gray_32x64, cv2.CV_32F, 1, 0, ksize=1)
        gy = cv2.Sobel(gray_32x64, cv2.CV_32F, 0, 1, ksize=1)
        mag = np.sqrt(gx**2 + gy**2)
        ang = (np.arctan2(gy, gx) * (180.0 / np.pi)) % 180.0

        hist_list = []
        for r in range(4):
            for c in range(2):
                cell_mag = mag[r*16:(r+1)*16, c*16:(c+1)*16].flatten()
                cell_ang = ang[r*16:(r+1)*16, c*16:(c+1)*16].flatten()
                h, _ = np.histogram(cell_ang, bins=8, range=(0, 180), weights=cell_mag)
                hist_list.append(h)
        hog_vec = np.concatenate(hist_list).astype(np.float32)
        norm = np.linalg.norm(hog_vec)
        if norm > 1e-6:
            hog_vec /= norm
        return hog_vec

    def extract(self, image: np.ndarray, bbox: Tuple[int, int, int, int], landmarks: np.ndarray) -> Tuple[np.ndarray, bool]:
        left_roi, right_roi = self.extract_rois(image, bbox, landmarks)
        left_vis = self._is_ear_visible(left_roi)
        right_vis = self._is_ear_visible(right_roi)

        target_roi = None
        if left_vis:
            target_roi = left_roi
        elif right_vis:
            target_roi = cv2.flip(right_roi, 1)
        else:
            return np.zeros(72, dtype=np.float32), False

        ear_standard = cv2.resize(target_roi, (32, 64))
        gray = cv2.cvtColor(ear_standard, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)

        # 1. 64-D Vectorized HOG descriptor
        hog_features = self.compute_ear_hog_64d(gray)

        # 2. 8-D Geometric aspect ratios and statistical moments
        aspect_ratio = float(target_roi.shape[0]) / max(1.0, float(target_roi.shape[1]))
        grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0)
        grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1)
        mag = np.sqrt(grad_x ** 2 + grad_y ** 2)

        geom_features = np.array([
            aspect_ratio / 3.0,
            float(np.mean(mag)) / 100.0,
            float(np.std(mag)) / 50.0,
            float(np.mean(gray)) / 255.0,
            float(np.std(gray)) / 100.0,
            float(np.percentile(gray, 25)) / 255.0,
            float(np.percentile(gray, 75)) / 255.0,
            1.0
        ], dtype=np.float32)

        combined = np.concatenate([hog_features, geom_features])
        norm = np.linalg.norm(combined)
        if norm > 1e-10:
            return combined / norm, True
        return combined, True


# ==============================================================================
# 6. ORCHESTRATOR: UNIFIED MULTIMODAL BIOMETRIC PIPELINE
# ==============================================================================

class BiometricPipeline:
    """
    Unified Production Biometric Pipeline:
    Coordinates Face Detection -> Canonical Alignment -> ArcFace 512-D
    -> Illumination-Compensated Skin 123-D -> Ear Biometrics 72-D
    -> Weighted Multimodal Concatenation (707-D).
    """

    def __init__(
        self,
        arcface_model: str = DEFAULT_ARCFACE_MODEL,
        yunet_model: str = DEFAULT_YUNET_MODEL,
        weight_arcface: float = 0.80,
        weight_skin: float = 0.12,
        weight_ear: float = 0.08
    ):
        self.detector = FaceDetector(yunet_model)
        self.arcface = ArcFaceEmbeddingExtractor(arcface_model)
        self.skin_extractor = SkinBiometricExtractor()
        self.ear_extractor = EarBiometricExtractor()

        self.w_arc = weight_arcface
        self.w_skin = weight_skin
        self.w_ear = weight_ear

    def extract_profile_from_image(
        self,
        image_bgr: np.ndarray,
        person_id: str = 'unknown',
        name: str = 'Desconhecido',
        metadata: Optional[Dict] = None
    ) -> Optional[BiometricProfile]:
        detections = self.detector.detect(image_bgr)
        if not detections:
            return None

        primary_det = max(detections, key=lambda d: d['bbox'][2] * d['bbox'][3])
        bbox = primary_det['bbox']
        landmarks = primary_det['landmarks']
        conf = primary_det['confidence']

        aligned_face = self.detector.align_face_canonical(image_bgr, landmarks)
        v_arc = self.arcface.extract(aligned_face)
        v_skin = self.skin_extractor.extract(aligned_face)
        v_ear, ear_visible = self.ear_extractor.extract(image_bgr, bbox, landmarks)

        if ear_visible:
            w_a, w_s, w_e = self.w_arc, self.w_skin, self.w_ear
        else:
            total = self.w_arc + self.w_skin
            w_a = self.w_arc / total
            w_s = self.w_skin / total
            w_e = 0.0

        fused = np.concatenate([w_a * v_arc, w_s * v_skin, w_e * v_ear]).astype(np.float32)
        fused_norm = np.linalg.norm(fused)
        if fused_norm > 1e-10:
            fused = fused / fused_norm

        return BiometricProfile(
            person_id=person_id,
            name=name,
            arcface_vector=v_arc,
            skin_vector=v_skin,
            ear_vector=v_ear,
            fused_vector=fused,
            ear_visible=ear_visible,
            quality_score=conf,
            bbox=bbox,
            landmarks=landmarks,
            metadata=metadata or {}
        )
