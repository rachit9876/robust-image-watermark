# Robust Image Watermarking Prototype (TrustMark + SQLite + Flask)

A 100% local, offline image watermarking and provenance authentication system built with Python, Flask, SQLite, and Adobe's open-source **TrustMark** universal watermarking framework.

<div align="left">

| | <img src="https://dr-fast-upload.pages.dev/public/8e68413286fd.webp" height="200" /> | |
| :---: | :---: | :---: |

</div>




## Architecture & Modular Design

```
robust-image-watermark/
├── app.py                  # Flask web server & REST endpoints
├── watermark.py            # TrustMark wrapper (encoding, decoding, ECC settings)
├── db.py                   # SQLite schema and query methods
├── test_robustness.py      # Benchmark script for JPEG, resize, and crop attacks
├── test_app.py             # Unit & integration tests for web endpoints & DB
├── requirements.txt        # Dependencies
├── static/
│   ├── style.css           # Modern dark UI theme
│   ├── watermark.js        # Page 1 client interaction & image preview/download
│   └── detector.js         # Page 2 client interaction & status rendering
└── templates/
    ├── base.html           # Layout shell with navigation
    ├── watermark.html      # Page 1 (Watermarking & Provenance generation)
    └── detector.html       # Page 2 (Watermark detection & attribution)
```

## Features

### 1. Page 1 — Watermark (`/`)
- Accepts username / creator name and an image upload (PNG, JPEG, WebP).
- Computes SHA-256 hash of the original image bytes.
- Generates a unique 8-character provenance ID.
- Embeds the payload imperceptibly into the image using TrustMark (`model_type='Q'`) protected by BCH error-correcting codes (`BCH_5`).
- Stores `provenance_id`, `username`, `original_image_hash`, and creation timestamp into local SQLite (`provenance.db`).
- Live preview of watermarked image with one-click download as PNG.

### 2. Page 2 — Detector (`/detector`)
- Accepts an image upload.
- Decodes embedded watermark payload using TrustMark.
- Validates the decoded ID against SQLite records:
  - **Verified**: Displays the authentic creator username, registration timestamp, and image hash.
  - **Unknown**: Displayed if a watermark payload is recovered but has no record in the local database.
  - **Inconclusive**: Displayed if no watermark could be detected (unwatermarked, corrupted, or altered past recovery thresholds).

### 3. Strict Local Execution
- All models, inference (PyTorch CPU/CUDA), and database queries run entirely on the local machine.
- No cloud dependencies, network calls, or third-party telemetry.

## Quick Start

### Easy Start (Windows)
Double-click **`start.bat`**. It will automatically:
- Set up UTF-8 and GPU acceleration
- Start the local Flask web server on `http://127.0.0.1:5000`
- Automatically launch your default browser to the web UI

### Manual Start
```bash
python app.py
```
Open your browser to [http://127.0.0.1:5000](http://127.0.0.1:5000).

3. Run automated tests:
   ```bash
   python -m unittest test_app.py
   ```

4. Run robustness benchmark:
   ```bash
   python test_robustness.py
   ```

## Robustness & Limitations (Benchmark Results)

Tested using `test_robustness.py` on a 512x512 synthetic test image with TrustMark `Q` and `BCH_5`:

| Transformation / Attack | Detected | Recovered ID | Status |
|:---|:---:|:---:|:---:|
| **Baseline (Lossless PNG)** | True | `FFHM41C7` | **PASS** |
| **JPEG Quality 95** | True | `FFHM41C7` | **PASS** |
| **JPEG Quality 80** | True | `FFHM41C7` | **PASS** |
| **JPEG Quality 60** | True | `FFHM41C7` | **PASS** |
| **JPEG Quality 40** | True | `FFHM41C7` | **PASS** |
| **JPEG Quality 20** | False | - | FAIL |
| **Resized to 75% (384x384)** | True | `FFHM41C7` | **PASS** |
| **Resized to 50% (256x256)** | True | `FFHM41C7` | **PASS** |
| **Resized to 35% (179x179)** | True | `FFHM41C7` | **PASS** |
| **Resized to 25% (128x128)** | True | `FFHM41C7` | **PASS** |
| **Center Crop 90% (460x460)** | True | `FFHM41C7` | **PASS** |
| **Center Crop 75% (384x384)** | True | `FFHM41C7` | **PASS** |
| **Center Crop 60% (307x307)** | False | - | FAIL |
| **Center Crop 40% (204x204)** | False | - | FAIL |

### Observations:
- **Compression**: Resilient to typical web JPEG compression (down to Quality 40). Highly compressed images (Q20) destroy the high-frequency residual signal.
- **Rescaling**: Excellent downscaling survival down to 25% original resolution.
- **Cropping**: Light cropping (up to ~75-90% area) retains enough spatial structure. Aggressive cropping requires the optional bounding box detector (`loadBBoxDetector=True`) and spatial alignment to detect localized tiles.
- **No Self-Healing Claim**: Watermarks do not guarantee attribution under arbitrary malicious manipulation or heavy spatial crops.
