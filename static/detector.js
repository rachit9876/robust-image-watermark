document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('detect-form');
    const imageInput = document.getElementById('detect-image-input');
    const dropZone = document.getElementById('detect-drop-zone');
    const dropPrompt = document.getElementById('detect-drop-prompt');
    const previewBox = document.getElementById('detect-preview-box');
    const previewImg = document.getElementById('detect-preview');
    const btnChange = document.getElementById('btn-change-detect-image');

    const btnSubmit = document.getElementById('btn-detect-submit');
    const btnText = btnSubmit.querySelector('.btn-text');
    const spinner = document.getElementById('detect-spinner');

    const statusMsg = document.getElementById('detect-status-message');
    const resultBox = document.getElementById('detect-result-box');
    const statusCard = document.getElementById('result-status-card');
    const statusIcon = document.getElementById('status-icon');
    const statusTitle = document.getElementById('status-title');
    const statusDesc = document.getElementById('status-desc');

    const verifiedDetails = document.getElementById('verified-details');
    const detUsername = document.getElementById('det-username');
    const detProvId = document.getElementById('det-provenance-id');
    const detDate = document.getElementById('det-date');
    const detEcc = document.getElementById('det-ecc');
    const detHash = document.getElementById('det-hash');

    // Drag and drop handling
    ['dragenter', 'dragover'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            imageInput.files = e.dataTransfer.files;
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    imageInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    btnChange.addEventListener('click', (e) => {
        e.stopPropagation();
        imageInput.value = '';
        dropPrompt.classList.remove('hidden');
        previewBox.classList.add('hidden');
    });

    function handleFileSelect(file) {
        if (!file.type.startsWith('image/')) {
            showError('Please upload an image file (PNG, JPG, WebP).');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            dropPrompt.classList.add('hidden');
            previewBox.classList.remove('hidden');
            hideStatus();
        };
        reader.readAsDataURL(file);
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!imageInput.files || imageInput.files.length === 0) {
            showError('Please select an image to inspect.');
            return;
        }

        const formData = new FormData();
        formData.append('image', imageInput.files[0]);

        setLoading(true);
        hideStatus();
        resultBox.classList.add('hidden');

        try {
            const resp = await fetch('/api/detect', {
                method: 'POST',
                body: formData
            });

            const data = await resp.json();

            renderDetectionResult(data);
            resultBox.classList.remove('hidden');
            resultBox.scrollIntoView({ behavior: 'smooth' });

        } catch (err) {
            showError('Network error or server unavailable: ' + err.message);
        } finally {
            setLoading(false);
        }
    });

    function renderDetectionResult(data) {
        statusCard.className = 'status-card';
        verifiedDetails.classList.add('hidden');

        if (data.status === 'Verified') {
            statusCard.classList.add('verified');
            statusIcon.textContent = '✅';
            statusTitle.textContent = `Verified Creator: ${data.username}`;
            statusTitle.style.color = '#34d399';
            statusDesc.textContent = `Watermark payload successfully recovered and authenticated against the local SQLite database.`;

            detUsername.textContent = data.record.username;
            detProvId.textContent = data.record.provenance_id;
            detDate.textContent = data.record.created_at;
            detEcc.textContent = data.record.ecc_scheme;
            detHash.textContent = data.record.original_image_hash;
            verifiedDetails.classList.remove('hidden');

        } else if (data.status === 'Unknown') {
            statusCard.classList.add('unknown');
            statusIcon.textContent = '⚠️';
            statusTitle.textContent = 'Unknown (Payload Recovered, No Record)';
            statusTitle.style.color = '#fbbf24';
            statusDesc.textContent = data.message || `Decoded payload "${data.recovered_id}", but no corresponding user record exists in the local registry.`;

        } else {
            // Inconclusive
            statusCard.classList.add('inconclusive');
            statusIcon.textContent = '❌';
            statusTitle.textContent = 'Inconclusive (No Watermark Detected)';
            statusTitle.style.color = '#f87171';
            statusDesc.textContent = data.message || 'The neural watermark detector was unable to decode an authenticated payload. The image may be unwatermarked, altered, or cropped beyond recovery limits.';
        }
    }

    function setLoading(isLoading) {
        btnSubmit.disabled = isLoading;
        if (isLoading) {
            btnText.textContent = 'Scanning & Decoding Watermark...';
            spinner.classList.remove('hidden');
        } else {
            btnText.textContent = 'Decode & Verify Watermark';
            spinner.classList.add('hidden');
        }
    }

    function showError(msg) {
        statusMsg.textContent = msg;
        statusMsg.className = 'alert alert-error';
        statusMsg.classList.remove('hidden');
    }

    function hideStatus() {
        statusMsg.classList.add('hidden');
    }
});
