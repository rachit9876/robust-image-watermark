const CACHE_NAME = 'trustmark-models-cache-v1';
const MODEL_BASE_URL = 'https://cai-watermark.adobe.net/watermarking/trustmark-models/';

// Set WASM paths for ONNX Runtime Web
if (typeof ort !== 'undefined' && ort.env && ort.env.wasm) {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    ort.env.wasm.numThreads = 1;
}

const MODEL_FILES = [
    { name: 'decoder_Q.onnx', url: MODEL_BASE_URL + 'decoder_Q.onnx', label: 'Decoder Model (Q)' },
    { name: 'resizer.onnx', url: MODEL_BASE_URL + 'resizer.onnx', label: 'Resizer Model' }
];

let session_decoder = null;
let session_resize = null;
let eccEngineInstances = [];

// Initialize BCH engines using official bch_ecc
function initECCEngines() {
    if (eccEngineInstances.length === 0 && typeof DataLayer_GetECCEngine === 'function') {
        for (let v = 0; v < 4; v++) {
            eccEngineInstances.push(DataLayer_GetECCEngine(v));
        }
    }
}

// Check cache status in browser CacheStorage
async function checkModelCacheStatus() {
    if (!('caches' in window)) {
        return { supported: false, cached: false, files: [] };
    }
    try {
        const cache = await caches.open(CACHE_NAME);
        const results = [];
        let allPresent = true;

        for (const m of MODEL_FILES) {
            const match = await cache.match(m.url);
            results.push({ name: m.name, cached: !!match });
            if (!match) allPresent = false;
        }

        return { supported: true, cached: allPresent, files: results };
    } catch (e) {
        console.warn('Cache check error:', e);
        return { supported: false, cached: false, files: [] };
    }
}

// Fetch model with cache fallback & progress reporting
async function fetchModelBlobWithCache(url, onProgress) {
    if ('caches' in window) {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(url);
        if (cachedResponse) {
            onProgress?.({ percent: 100, loadedMB: 0, totalMB: 0, fromCache: true });
            const buf = await cachedResponse.arrayBuffer();
            return new Uint8Array(buf);
        }

        // Not cached: stream download to track real progress
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 47401222;
        let loaded = 0;

        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;

            const percent = Math.min(100, Math.round((loaded / total) * 100));
            onProgress?.({
                percent,
                loadedMB: (loaded / (1024 * 1024)).toFixed(1),
                totalMB: (total / (1024 * 1024)).toFixed(1),
                fromCache: false
            });
        }

        const combined = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        try {
            await cache.put(url, new Response(combined.buffer, {
                headers: { 'Content-Type': 'application/octet-stream' }
            }));
        } catch (e) {
            console.warn('Cache write warning:', e);
        }

        return combined;
    } else {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
        const buf = await response.arrayBuffer();
        return new Uint8Array(buf);
    }
}

// Clear browser cache for models
async function clearModelCache() {
    if ('caches' in window) {
        await caches.delete(CACHE_NAME);
    }
    session_decoder = null;
    session_resize = null;
}

// Load ONNX sessions with WebGPU/WASM
async function loadTrustMarkSessions(progressCallback) {
    if (typeof ort !== 'undefined' && ort.env && ort.env.wasm) {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
        ort.env.wasm.numThreads = 1;
    }

    initECCEngines();

    if (session_decoder && session_resize) {
        return { status: 'already_loaded' };
    }

    progressCallback?.({ stage: 'resizer', message: 'Loading Resizer Model...' });
    const resizerData = await fetchModelBlobWithCache(MODEL_BASE_URL + 'resizer.onnx');
    session_resize = await ort.InferenceSession.create(resizerData, { executionProviders: ['wasm'] });

    progressCallback?.({ stage: 'decoder', message: 'Preparing Decoder Q (47 MB)...' });
    const decoderData = await fetchModelBlobWithCache(MODEL_BASE_URL + 'decoder_Q.onnx', (p) => {
        if (p.fromCache) {
            progressCallback?.({ stage: 'cache', message: 'Instant load from browser cache (100%)', percent: 100 });
        } else {
            progressCallback?.({
                stage: 'download',
                message: `Downloading Decoder Q: ${p.loadedMB} MB / ${p.totalMB} MB (${p.percent}%)`,
                percent: p.percent
            });
        }
    });

    progressCallback?.({ stage: 'init', message: 'Initializing Neural Session (WebGPU/WASM)...' });

    // Try WebGPU first, then WASM
    try {
        session_decoder = await ort.InferenceSession.create(decoderData, { executionProviders: ['webgpu'] });
        console.log('Decoder Q initialized via WebGPU');
    } catch (e) {
        console.warn('WebGPU fallback to WASM:', e);
        session_decoder = await ort.InferenceSession.create(decoderData, { executionProviders: ['wasm'] });
        console.log('Decoder Q initialized via WASM');
    }

    return { status: 'loaded' };
}

// Convert 7-bit ASCII bit array to String (TrustMark encoding standard)
function bitsToAscii7(bitstr) {
    let text = '';
    for (let i = 0; i + 7 <= bitstr.length; i += 7) {
        const val = parseInt(bitstr.substring(i, i + 7), 2);
        if (val > 0 && val < 127) {
            text += String.fromCharCode(val);
        }
    }
    return text.trim();
}

// Image Loader into RGB Tensor [1, 3, H, W] in range [0, 1]
async function loadImageAsTensor(imgElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;
    ctx.drawImage(imgElement, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imgData;
    const totalPixels = width * height;
    const tensorData = new Float32Array(totalPixels * 3);

    const page = width * height;
    const twopage = 2 * page;

    for (let i = 0; i < totalPixels; i++) {
        const srcIdx = i * 4;
        tensorData[i] = data[srcIdx] / 255.0;            // R
        tensorData[i + page] = data[srcIdx + 1] / 255.0;  // G
        tensorData[i + twopage] = data[srcIdx + 2] / 255.0; // B
    }

    return new ort.Tensor('float32', tensorData, [1, 3, height, width]);
}

// Resize Tensor via official Adobe resizer.onnx
async function resizeTensor(inputTensor, targetSize) {
    const [batch, channels, height, width] = inputTensor.dims;
    const scaleH = targetSize / height;
    const scaleW = targetSize / width;
    const scales = new Float32Array([1.0, 1.0, scaleH, scaleW]);

    const feeds = {
        'X': inputTensor,
        'scales': new ort.Tensor('float32', scales, [4]),
        'target_size': new ort.Tensor('int64', new BigInt64Array([BigInt(targetSize)]), [1])
    };

    const res = await session_resize.run(feeds);
    return res['Y'];
}

// Core Watermark Extraction Pipeline (Intelligent Multi-Strategy Detector)
async function decodeImageWatermark(imgElement) {
    if (!session_decoder) {
        throw new Error('Models not loaded yet. Please click "Load Model" first.');
    }

    initECCEngines();

    const origW = imgElement.naturalWidth || imgElement.width;
    const origH = imgElement.naturalHeight || imgElement.height;

    // Helper: Draw candidate crop directly to 256x256 using browser's high-quality bilinear interpolation
    async function evaluateCrop(cropLeft, cropTop, cropW, cropH) {
        cropLeft = Math.max(0, Math.floor(cropLeft));
        cropTop = Math.max(0, Math.floor(cropTop));
        cropW = Math.min(origW - cropLeft, Math.floor(cropW));
        cropH = Math.min(origH - cropTop, Math.floor(cropH));

        if (cropW < 64 || cropH < 64) return null;

        // Render directly to 256x256 canvas with high-quality bilinear antialiasing
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(
            imgElement,
            cropLeft, cropTop, cropW, cropH,
            0, 0, 256, 256
        );

        const imgData = ctx.getImageData(0, 0, 256, 256);
        const { data } = imgData;
        const totalPixels = 256 * 256;
        const tensorData = new Float32Array(totalPixels * 3);

        const page = 256 * 256;
        const twopage = 2 * page;

        for (let i = 0; i < totalPixels; i++) {
            const srcIdx = i * 4;
            tensorData[i] = data[srcIdx] / 255.0;
            tensorData[i + page] = data[srcIdx + 1] / 255.0;
            tensorData[i + twopage] = data[srcIdx + 2] / 255.0;
        }

        const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, 256, 256]);
        const res = await session_decoder.run({ 'image': inputTensor });

        const rawFloats = res['output'].cpuData || res['output'].data;
        const boolBits = Array.from(rawFloats).map(v => v >= 0);

        const decodedObj = DataLayer_Decode(boolBits, eccEngineInstances, 'Q');

        // Strictly ensure decodedObj is valid and has verified bitflips
        if (decodedObj && decodedObj.valid && decodedObj.bitflips >= 0) {
            const text = bitsToAscii7(decodedObj.data_binary);
            // Verify payload is valid ASCII characters (not corrupt noise)
            if (text && /^[\x20-\x7E]+$/.test(text)) {
                return {
                    valid: true,
                    schema: decodedObj.schema,
                    bitflips: decodedObj.bitflips,
                    recovered_id: text,
                    raw_bits: decodedObj.data_binary || ''
                };
            }
        }
        return null;
    }

    // Generate intelligent candidates:
    const candidateList = [];
    const seen = new Set();

    function addCandidate(l, t, w, h, label) {
        const key = `${Math.floor(l)}_${Math.floor(t)}_${Math.floor(w)}_${Math.floor(h)}`;
        if (!seen.has(key)) {
            seen.add(key);
            candidateList.push({ l, t, w, h, label });
        }
    }

    // 1. Pristine Full Frame
    addCandidate(0, 0, origW, origH, "Full original frame");

    // 2. Center Focal Crops (80%, 85%, 90% - essential for screenshots after compression/meta removal)
    for (const scale of [0.80, 0.85, 0.90, 0.75]) {
        const sw = Math.floor(origW * scale);
        const sh = Math.floor(origH * scale);
        addCandidate(Math.floor((origW - sw) / 2), Math.floor((origH - sh) / 2), sw, sh, `Focal Zoom (${Math.round(scale * 100)}%)`);
    }

    // 3. Circular Avatar / Profile Picture (Inscribed 1:1 Square)
    const minDim = Math.min(origW, origH);
    const inscribedSide = Math.floor(minDim * 0.7071);
    const cx = Math.floor(origW / 2);
    const cy = Math.floor(origH / 2);
    addCandidate(cx - inscribedSide / 2, cy - inscribedSide / 2, inscribedSide, inscribedSide, "Circular DP (Inscribed 1:1)");

    // 4. Center 1:1 Square Crop
    addCandidate(Math.floor((origW - minDim) / 2), Math.floor((origH - minDim) / 2), minDim, minDim, "Center 1:1 Square");

    // 5. Common Aspect Ratio Priors
    if (origH > origW) {
        const targetH = Math.floor(origW * 1.25);
        if (targetH <= origH) {
            addCandidate(0, Math.floor((origH - targetH) / 2), origW, targetH, "4:5 Mobile Portrait");
        }
    } else if (origW > origH) {
        const targetW = Math.floor(origH * 16 / 9);
        if (targetW <= origW) {
            addCandidate(Math.floor((origW - targetW) / 2), 0, targetW, origH, "16:9 Landscape");
        }
    }

    // Evaluate candidates sequentially
    for (const cand of candidateList) {
        const res = await evaluateCrop(cand.l, cand.t, cand.w, cand.h);
        if (res) {
            res.details = `Recovered via ${cand.label}`;
            return res;
        }
    }

    return {
        valid: false,
        schema: null,
        bitflips: 0,
        recovered_id: '',
        raw_bits: ''
    };
}
