"""
SecureVision AI - Batch Face Registration & Vector Generation CLI
=================================================================
Senior Computer Vision & AI Architecture Pipeline (Phase 1: Registry)

Scans a dataset directory of enrolled photos, extracts deep ArcFace 512-D
structural embeddings, illumination-compensated skin vectors, and ear biometrics,
fuses them into 707-D unit vectors, and registers them into a FAISS index.

Usage:
    python register_faces.py --dataset dataset/ --storage storage/
"""

import argparse
from pathlib import Path
import os
import sys
import time

import cv2
import numpy as np

from biometric_engine import BiometricPipeline, DEFAULT_ARCFACE_MODEL, DEFAULT_YUNET_MODEL
from vector_registry import VectorRegistry, DEFAULT_STORAGE_DIR

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="SecureVision AI: Batch Biometric Vector Generation & FAISS Enrollment"
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default="dataset",
        help="Path to folder containing photos (supports subfolders per person or named image files)"
    )
    parser.add_argument(
        "--storage",
        type=str,
        default=DEFAULT_STORAGE_DIR,
        help="Path to directory where FAISS index and metadata will be saved"
    )
    parser.add_argument(
        "--arcface-model",
        type=str,
        default=DEFAULT_ARCFACE_MODEL,
        help="Path to ArcFace ONNX model"
    )
    parser.add_argument(
        "--yunet-model",
        type=str,
        default=DEFAULT_YUNET_MODEL,
        help="Path to YuNet face detector ONNX model"
    )
    parser.add_argument(
        "--w-arc",
        type=float,
        default=0.80,
        help="Weight for deep ArcFace structural vector (default: 0.80)"
    )
    parser.add_argument(
        "--w-skin",
        type=float,
        default=0.12,
        help="Weight for illumination-compensated skin vector (default: 0.12)"
    )
    parser.add_argument(
        "--w-ear",
        type=float,
        default=0.08,
        help="Weight for ear biometrics vector (default: 0.08)"
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Wipe existing FAISS registry before enrolling new dataset"
    )
    return parser.parse_args()


def scan_dataset(dataset_dir: Path):
    """
    Discovers image files in the dataset.
    Supports both subfolders per person and individual named files.
    """
    entries = []
    if not dataset_dir.exists():
        print(f"[!] Dataset directory does not exist: {dataset_dir}")
        return entries

    # Check for subdirectories
    subdirs = [p for p in dataset_dir.iterdir() if p.is_dir()]
    if subdirs:
        for sdir in sorted(subdirs):
            person_name = sdir.name.replace("_", " ")
            person_id = sdir.name.lower().replace(" ", "_")
            images = [f for f in sdir.iterdir() if f.suffix.lower() in SUPPORTED_EXTS]
            for img_path in images:
                entries.append({
                    "person_id": person_id,
                    "name": person_name,
                    "image_path": img_path
                })
    else:
        # Check flat folder with named image files
        files = [f for f in dataset_dir.iterdir() if f.is_file() and f.suffix.lower() in SUPPORTED_EXTS]
        for f in sorted(files):
            stem = f.stem
            # Clean up potential separators: 'Carlos_Alberto_01' -> 'Carlos Alberto'
            clean_name = stem.split("_")[0] if "_" in stem and stem.split("_")[-1].isdigit() else stem
            clean_name = clean_name.replace("_", " ")
            person_id = stem.lower().replace(" ", "_")
            entries.append({
                "person_id": person_id,
                "name": clean_name,
                "image_path": f
            })
    return entries


def main():
    args = parse_args()
    dataset_path = Path(args.dataset)
    storage_path = Path(args.storage)

    print("=================================================================")
    print("      SECUREVISION AI - BIOMETRIC VECTOR REGISTRY GENERATOR      ")
    print("=================================================================")
    print(f"[*] Dataset Source:    {dataset_path.resolve()}")
    print(f"[*] Vector Storage:    {storage_path.resolve()}")
    print(f"[*] Fusion Weights:    ArcFace={args.w_arc} | Skin={args.w_skin} | Ear={args.w_ear}")

    if not dataset_path.exists():
        print(f"\n[!] Creating empty dataset folder at '{dataset_path}' for your photos.")
        dataset_path.mkdir(parents=True, exist_ok=True)
        print("[i] Place your photos in this folder and re-run this script.")
        return

    entries = scan_dataset(dataset_path)
    if not entries:
        print(f"\n[!] No supported images found in '{dataset_path}'.")
        print("    Supported formats: JPG, JPEG, PNG, WEBP, BMP.")
        return

    print(f"[*] Discovered {len(entries)} image file(s) for biometric processing.")

    # Initialize Engine Pipeline
    print("[*] Initializing ArcFace Engine & YuNet Neural Detector...")
    pipeline = BiometricPipeline(
        arcface_model=args.arcface_model,
        yunet_model=args.yunet_model,
        weight_arcface=args.w_arc,
        weight_skin=args.w_skin,
        weight_ear=args.w_ear
    )

    # Initialize / Reset FAISS Vector Registry
    if args.clear:
        index_file = storage_path / "biometric_registry.faiss"
        meta_file = storage_path / "biometric_registry.json"
        if index_file.exists():
            index_file.unlink()
        if meta_file.exists():
            meta_file.unlink()
        print("[*] Cleared existing FAISS vector registry.")

    registry = VectorRegistry(dimension=707, storage_dir=str(storage_path))
    print(f"[*] Vector Registry loaded: currently holds {registry.count()} identities.")

    start_time = time.perf_counter()
    enrolled_count = 0
    skipped_count = 0

    print("\n-----------------------------------------------------------------")
    print(f"{'#':<3} | {'PERSON NAME':<20} | {'EAR':<8} | {'QUALITY':<8} | {'STATUS'}")
    print("-----------------------------------------------------------------")

    for i, entry in enumerate(entries, start=1):
        img_p = entry["image_path"]
        img = cv2.imread(str(img_p))

        if img is None:
            print(f"{i:<3} | {entry['name']:<20} | {'-':<8} | {'-':<8} | FAILED (Unreadable image)")
            skipped_count += 1
            continue

        profile = pipeline.extract_profile_from_image(
            image_bgr=img,
            person_id=entry["person_id"],
            name=entry["name"],
            metadata={"source_file": str(img_p)}
        )

        if profile is None:
            print(f"{i:<3} | {entry['name']:<20} | {'-':<8} | {'-':<8} | NO FACE DETECTED")
            skipped_count += 1
            continue

        ear_status = "OK" if profile.ear_visible else "OCCLUDED"
        quality_str = f"{profile.quality_score * 100:.1f}%"

        # Register profile into FAISS
        registry.add_profile(
            fused_vector=profile.fused_vector,
            person_id=profile.person_id,
            name=profile.name,
            arcface_vector=profile.arcface_vector,
            skin_vector=profile.skin_vector,
            ear_vector=profile.ear_vector,
            ear_visible=profile.ear_visible,
            quality_score=profile.quality_score,
            extra_metadata=profile.metadata
        )

        print(f"{i:<3} | {profile.name:<20} | {ear_status:<8} | {quality_str:<8} | REGISTERED")
        enrolled_count += 1

    # Save to disk
    registry.save()
    elapsed = time.perf_counter() - start_time

    print("-----------------------------------------------------------------")
    print(f"\n[+] ENROLLMENT COMPLETE IN {elapsed:.2f}s!")
    print(f"    - Successfully Enrolled: {enrolled_count}")
    print(f"    - Skipped / Failed:      {skipped_count}")
    print(f"    - Total in Vector DB:    {registry.count()}")
    print(f"    - FAISS Index File:      {registry.index_path.resolve()}")
    print(f"    - Metadata JSON File:    {registry.meta_path.resolve()}")
    print("=================================================================\n")


if __name__ == "__main__":
    main()
