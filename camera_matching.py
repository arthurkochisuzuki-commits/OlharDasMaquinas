"""
SecureVision AI - Real-Time Camera Inference & Vector Matching
==============================================================
Senior Computer Vision & AI Architecture Pipeline (Phase 2: Camera Matching)

Receives live video feeds (Webcam, RTSP stream, or Video File), detects faces in real-time,
extracts multi-modal biometric embeddings (ArcFace 512-D + Skin + Ear), queries FAISS
in sub-millisecond latency, and renders a professional surveillance HUD with calibrated confidence.

Usage:
    python camera_matching.py --source 0 --threshold 0.65
"""

import argparse
from pathlib import Path
import time
from typing import Dict, List, Optional, Tuple, Union

import cv2
import numpy as np

from biometric_engine import BiometricPipeline, DEFAULT_ARCFACE_MODEL, DEFAULT_YUNET_MODEL
from vector_registry import VectorRegistry, DEFAULT_STORAGE_DIR


def match_live_face(
    frame_bgr: np.ndarray,
    pipeline: BiometricPipeline,
    registry: VectorRegistry,
    threshold: float = 0.65,
    top_k: int = 1
) -> List[Dict]:
    """
    Core function: Receives a live camera frame, extracts biometric signatures for all
    detected faces, queries the FAISS vector database, and returns the identification results
    including calibrated confidence percentage and forensic breakdown.
    """
    results = []
    detections = pipeline.detector.detect(frame_bgr)
    if not detections:
        return results

    for det in detections:
        bbox = det["bbox"]
        landmarks = det["landmarks"]
        conf = det["confidence"]

        # 1. Canonical 2D Affine Similarity Alignment
        aligned = pipeline.detector.align_face_canonical(frame_bgr, landmarks)

        # 2. Extract Multimodal Vectors
        v_arc = pipeline.arcface.extract(aligned)
        v_skin = pipeline.skin_extractor.extract(aligned)
        v_ear, ear_vis = pipeline.ear_extractor.extract(frame_bgr, bbox, landmarks)

        # 3. Dynamic Weighted Fusion
        if ear_vis:
            w_a, w_s, w_e = pipeline.w_arc, pipeline.w_skin, pipeline.w_ear
        else:
            tot = pipeline.w_arc + pipeline.w_skin
            w_a, w_s, w_e = pipeline.w_arc / tot, pipeline.w_skin / tot, 0.0

        fused = np.concatenate([w_a * v_arc, w_s * v_skin, w_e * v_ear]).astype(np.float32)
        norm = np.linalg.norm(fused)
        if norm > 1e-10:
            fused = fused / norm

        # 4. Query FAISS Vector Database (< 0.3 ms)
        t0 = time.perf_counter()
        matches = registry.search(
            query_vector=fused,
            query_arcface=v_arc,
            query_skin=v_skin,
            query_ear=v_ear if ear_vis else None,
            top_k=top_k,
            decision_threshold=threshold
        )
        search_latency_ms = (time.perf_counter() - t0) * 1000.0

        if matches:
            best_match = matches[0]
            is_match = best_match["is_match"]
            results.append({
                "bbox": bbox,
                "landmarks": landmarks,
                "detection_conf": conf,
                "person_id": best_match["person_id"] if is_match else "unknown",
                "name": best_match["name"] if is_match else "DESCONHECIDO",
                "is_authorized": is_match,
                "cosine_similarity": best_match["cosine_similarity"],
                "confidence_percent": best_match["confidence_percent"],
                "forensic": best_match["forensic"],
                "ear_visible": ear_vis,
                "search_latency_ms": search_latency_ms
            })
        else:
            # Vector registry is empty
            results.append({
                "bbox": bbox,
                "landmarks": landmarks,
                "detection_conf": conf,
                "person_id": "unknown",
                "name": "SEM CADASTROS",
                "is_authorized": False,
                "cosine_similarity": 0.0,
                "confidence_percent": 0.0,
                "forensic": {},
                "ear_visible": ear_vis,
                "search_latency_ms": search_latency_ms
            })
    return results


def draw_surveillance_hud(
    frame: np.ndarray,
    matches: List[Dict],
    fps: float,
    registry_count: int,
    show_forensic: bool = True
):
    """
    Renders an ultra-modern, high-tech security surveillance HUD on the live frame.
    """
    h, w = frame.shape[:2]

    # Top Status Bar Overlay
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 40), (10, 15, 25), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

    # Top header text
    cv2.putText(frame, "SECUREVISION AI - VIGILANCIA BIOMETRICA 24H", (16, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.60, (0, 240, 255), 2, cv2.LINE_AA)
    stats_text = f"FPS: {fps:4.1f} | IDENTIDADES NO FAISS: {registry_count}"
    cv2.putText(frame, stats_text, (w - 380, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (200, 220, 240), 1, cv2.LINE_AA)

    for res in matches:
        x, y, fw, fh = res["bbox"]
        is_auth = res["is_authorized"]
        name = res["name"]
        conf_pct = res["confidence_percent"]
        cos_sim = res["cosine_similarity"]
        forensic = res.get("forensic", {})
        ear_vis = res.get("ear_visible", False)

        if is_auth:
            color = (0, 220, 70)      # Green
            badge = f"[AUTORIZADO] {name}"
            conf_display = f"{conf_pct:.1f}%"
        else:
            color = (40, 40, 235)     # Red
            badge = f"[ALERTA] {name}"
            conf_display = f"Cos: {cos_sim:.2f}"

        # Bounding Box with rounded corners
        cv2.rectangle(frame, (x, y), (x + fw, y + fh), color, 2)
        corner_len = min(20, fw // 4, fh // 4)
        t = 3
        cv2.line(frame, (x, y), (x + corner_len, y), color, t)
        cv2.line(frame, (x, y), (x, y + corner_len), color, t)
        cv2.line(frame, (x + fw, y), (x + fw - corner_len, y), color, t)
        cv2.line(frame, (x + fw, y), (x + fw, y + corner_len), color, t)
        cv2.line(frame, (x, y + fh), (x + corner_len, y + fh), color, t)
        cv2.line(frame, (x, y + fh), (x, y + fh - corner_len), color, t)
        cv2.line(frame, (x + fw, y + fh), (x + fw - corner_len, y + fh), color, t)
        cv2.line(frame, (x + fw, y + fh), (x + fw, y + fh - corner_len), color, t)

        # Draw 5 facial landmarks (cyan dots)
        if "landmarks" in res and res["landmarks"] is not None:
            for pt in res["landmarks"]:
                cv2.circle(frame, (int(pt[0]), int(pt[1])), 3, (255, 230, 0), -1, cv2.LINE_AA)

        # Name Tag Banner
        tag_y = max(24, y - 8)
        tag_bg_w = max(180, int(len(badge) * 11) + 80)
        cv2.rectangle(frame, (x, tag_y - 22), (x + tag_bg_w, tag_y + 4), (10, 15, 25), -1)
        cv2.rectangle(frame, (x, tag_y - 22), (x + tag_bg_w, tag_y + 4), color, 1)

        cv2.putText(frame, badge, (x + 6, tag_y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, conf_display, (x + tag_bg_w - 75, tag_y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.48, color, 2, cv2.LINE_AA)

        # Forensic Sub-Score Breakdown below face
        if show_forensic:
            info_y = y + fh + 18
            arc_cos = forensic.get("arcface_cosine", cos_sim)
            skin_cos = forensic.get("skin_cosine", 0.0)
            ear_str = f"{forensic.get('ear_cosine', 0.0):.2f}" if ear_vis else "OCLUSAO"

            detail_text = f"ArcFace:{arc_cos:.2f} | Pele:{skin_cos:.2f} | Orelha:{ear_str}"
            cv2.rectangle(frame, (x, info_y - 12), (x + max(180, fw), info_y + 4), (15, 20, 30), -1)
            cv2.putText(frame, detail_text, (x + 4, info_y), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 200, 220), 1, cv2.LINE_AA)


def main():
    parser = argparse.ArgumentParser(description="SecureVision AI: Real-Time Camera Biometric Inference")
    parser.add_argument("--source", type=str, default="0", help="Camera index (e.g. 0), video file path, or RTSP URL")
    parser.add_argument("--storage", type=str, default=DEFAULT_STORAGE_DIR, help="Path to FAISS storage directory")
    parser.add_argument("--threshold", type=float, default=0.65, help="Cosine similarity decision threshold (default: 0.65)")
    parser.add_argument("--arcface-model", type=str, default=DEFAULT_ARCFACE_MODEL, help="Path to ArcFace ONNX model")
    parser.add_argument("--yunet-model", type=str, default=DEFAULT_YUNET_MODEL, help="Path to YuNet face detector ONNX model")
    parser.add_argument("--benchmark-frames", type=int, default=0, help="Run headless benchmark for N frames and exit")
    args = parser.parse_args()

    print("=================================================================")
    print("      SECUREVISION AI - REAL-TIME BIOMETRIC CAMERA MATCHING      ")
    print("=================================================================")

    pipeline = BiometricPipeline(
        arcface_model=args.arcface_model,
        yunet_model=args.yunet_model,
        weight_arcface=0.80,
        weight_skin=0.12,
        weight_ear=0.08
    )

    print(f"[*] Loading FAISS Vector Registry from: {args.storage}")
    registry = VectorRegistry(dimension=707, storage_dir=args.storage)
    print(f"[*] FAISS Index loaded: {registry.count()} registered identities.")

    source = int(args.source) if args.source.isdigit() else args.source
    print(f"[*] Opening video source: {source}...")
    cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        print(f"[!] ERROR: Could not open video source '{source}'.")
        print("    If using a webcam, ensure index 0 is connected and allowed by OS permissions.")
        print("    You can also pass a video file path: --source video.mp4")
        return

    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    print("\n[+] CAMERA STREAM ACTIVE! Controls:")
    print("    - Press 'q' or 'ESC' to exit")
    print("    - Press 's' to save a security snapshot")
    print("    - Press 'f' to toggle forensic details")
    print("    - Press 'r' to reload FAISS registry from disk\n")

    fps_buffer = []
    show_forensic = True
    frame_idx = 0

    try:
        while True:
            t_start = time.perf_counter()
            ret, frame = cap.read()
            if not ret:
                break

            frame_idx += 1

            matches = match_live_face(
                frame_bgr=frame,
                pipeline=pipeline,
                registry=registry,
                threshold=args.threshold,
                top_k=1
            )

            t_elapsed = time.perf_counter() - t_start
            current_fps = 1.0 / max(1e-5, t_elapsed)
            fps_buffer.append(current_fps)
            if len(fps_buffer) > 30:
                fps_buffer.pop(0)
            avg_fps = sum(fps_buffer) / len(fps_buffer)

            if args.benchmark_frames > 0:
                if frame_idx >= args.benchmark_frames:
                    print(f"[*] Headless benchmark complete: {frame_idx} frames at {avg_fps:.1f} FPS.")
                    break
                continue

            draw_surveillance_hud(frame, matches, avg_fps, registry.count(), show_forensic)
            cv2.imshow("SecureVision AI - Real-Time Biometric Surveillance", frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == 27:
                break
            elif key == ord('s'):
                snap_path = f"snapshot_{int(time.time())}.jpg"
                cv2.imwrite(snap_path, frame)
                print(f"[+] Security snapshot saved: {snap_path}")
            elif key == ord('f'):
                show_forensic = not show_forensic
            elif key == ord('r'):
                registry.load()
                print(f"[*] Vector registry reloaded: {registry.count()} identities.")

    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("[*] Video stream terminated.")


if __name__ == "__main__":
    main()
