import sys
import os
import hashlib
import io
import secrets
import string

# Dynamically link the existing CUDA-enabled PyTorch build from ghost-in-the-gpu in READ-ONLY mode
# This unlocks your RTX 5050 GPU without downloading or duplicating any GBs of torch packages.
_ghost_site = r"C:\Users\Rachit\Documents\GitHub\ghost-in-the-gpu\.venv\Lib\site-packages"
if os.path.exists(_ghost_site) and _ghost_site not in sys.path:
    sys.path.insert(0, _ghost_site)

import torch
from PIL import Image
from trustmark import TrustMark

# Singleton or cached TrustMark model instances for CPU/local execution
_models = {}

def get_trustmark_instance(model_type: str = 'Q', use_ECC: bool = True) -> TrustMark:
    key = (model_type, use_ECC)
    if key not in _models:
        _models[key] = TrustMark(
            verbose=False,
            model_type=model_type,
            use_ECC=use_ECC,
            loadRemover=False,
            loadBBoxDetector=False
        )
    return _models[key]

def generate_provenance_id(length: int = 8) -> str:
    """
    Generate an alphanumeric unique provenance ID.
    Under TrustMark's BCH_5 schema (61 payload bits, 7-bit ASCII encoding),
    up to 8 uppercase alphanumeric characters fit securely into 56 bits.
    """
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))

def compute_image_hash(image_bytes: bytes) -> str:
    """Compute standard SHA-256 hash of the input image bytes."""
    return hashlib.sha256(image_bytes).hexdigest()

def embed_watermark(image: Image.Image, provenance_id: str, model_type: str = 'Q', wm_strength: float = 1.0) -> Image.Image:
    """
    Embed provenance ID into a PIL image using TrustMark.
    Ensures RGB mode and returns the watermarked PIL Image.
    """
    tm = get_trustmark_instance(model_type=model_type, use_ECC=True)
    rgb_image = image.convert("RGB")
    watermarked_image = tm.encode(
        rgb_image,
        string_secret=provenance_id,
        MODE='text',
        WM_STRENGTH=wm_strength
    )
    return watermarked_image

def generate_candidate_crops(image: Image.Image):
    """
    Intelligent Candidate Generator for real-world scenarios:
      1. Raw full image (lossless, compressed, or pristine)
      2. Background variance auto-snapping (auto-trims asymmetrical viewer padding, taskbars, letterboxing)
      3. Circular avatar / DP inscribed square crop (extracts 1:1 square inscribed within circular DP)
      4. Standard aspect-ratio anchors (1:1 square, 4:5 mobile feed, 16:9 landscape, 9:16 story)
      5. Multi-scale focal crops (75% and 85% center zooms)
    """
    candidates = []
    seen_boxes = set()

    w, h = image.size
    
    # Helper to add candidate box
    def add_box(left, top, right, bottom, strategy_label):
        left = max(0, int(left))
        top = max(0, int(top))
        right = min(w, int(right))
        bottom = min(h, int(bottom))
        cw = right - left
        ch = bottom - top
        if cw >= 64 and ch >= 64:
            box = (left, top, right, bottom)
            if box not in seen_boxes:
                seen_boxes.add(box)
                candidates.append((box, strategy_label))

    # Candidate 1: Full pristine image
    add_box(0, 0, w, h, "Full image")

    # Candidate 2: Dynamic Edge Variance Auto-Snapping
    try:
        import numpy as np
        arr = np.array(image)
        if len(arr.shape) == 3:
            row_stds = np.std(arr, axis=(1, 2))
            col_stds = np.std(arr, axis=(0, 2))
            
            # Dynamic threshold based on median edge variance
            bg_thresh = max(10.0, np.percentile(np.concatenate([row_stds[:15], row_stds[-15:], col_stds[:15], col_stds[-15:]]), 75))
            
            r_idx = np.where(row_stds > bg_thresh)[0]
            c_idx = np.where(col_stds > bg_thresh)[0]
            if len(r_idx) > 10 and len(c_idx) > 10:
                top_snap = r_idx[0]
                bottom_snap = r_idx[-1]
                left_snap = c_idx[0]
                right_snap = c_idx[-1]
                add_box(left_snap, top_snap, right_snap, bottom_snap, "Edge-energy auto-snapping (UI frame removed)")
    except Exception:
        pass

    # Candidate 3: Circular DP Inscribed Square
    # For circular profile photos, the maximum inscribed square has side = D / sqrt(2) ~ 0.707 * min_dim
    min_dim = min(w, h)
    inscribed_side = int(min_dim * 0.7071)
    cx, cy = w // 2, h // 2
    add_box(
        cx - inscribed_side // 2,
        cy - inscribed_side // 2,
        cx + inscribed_side // 2,
        cy + inscribed_side // 2,
        "Circular Avatar / Profile Picture (Inscribed 1:1 square)"
    )

    # Candidate 4: Center Square (1:1)
    side = min(w, h)
    add_box((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2, "Center 1:1 square")

    # Candidate 5: Common Mobile Feed Ratios (4:5 portrait & 16:9 story)
    if h > w:
        # 4:5 ratio crop
        target_h = int(w * 1.25)
        if target_h <= h:
            add_box(0, (h - target_h) // 2, w, (h + target_h) // 2, "4:5 Mobile Portrait Feed")
    elif w > h:
        # 16:9 landscape
        target_w = int(h * 16 / 9)
        if target_w <= w:
            add_box((w - target_w) // 2, 0, (w + target_w) // 2, h, "16:9 Landscape")

    # Candidate 6: Standard Multi-scale Center Zooms
    for scale in [0.90, 0.80]:
        sw, sh = int(w * scale), int(h * scale)
        add_box((w - sw) // 2, (h - sh) // 2, (w + sw) // 2, (h + sh) // 2, f"Center focal crop ({int(scale*100)}%)")

    return candidates

def detect_watermark(image: Image.Image, model_type: str = 'Q') -> dict:
    """
    Intelligent watermark detector with zero hardcoded compromises.
    Evaluates candidate bounding boxes generated by edge variance auto-snapping,
    circular DP geometry, and aspect-ratio anchors.
    """
    tm = get_trustmark_instance(model_type=model_type, use_ECC=True)
    rgb_image = image.convert("RGB")

    candidates = generate_candidate_crops(rgb_image)

    for (left, top, right, bottom), strategy in candidates:
        crop = rgb_image.crop((left, top, right, bottom))
        try:
            secret_pred, detected, version = tm.decode(crop, MODE='text', ROTATION=False)
            cleaned = secret_pred.strip().replace("\x00", "") if secret_pred else ""
            if detected and cleaned:
                return {
                    "success": True,
                    "raw_payload": secret_pred,
                    "provenance_id": cleaned,
                    "version": version,
                    "details": f"Detection: {detected}, Schema version: {version} [Strategy: {strategy}]"
                }
        except Exception:
            continue

    return {
        "success": False,
        "raw_payload": "",
        "provenance_id": "",
        "version": -1,
        "details": "No detectable watermark payload could be decoded across intelligent spatial candidates."
    }
