document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('watermark-form');
    const imageInput = document.getElementById('image-input');
    const dropZone = document.getElementById('drop-zone');
    const dropPrompt = document.getElementById('drop-prompt');
    const previewBox = document.getElementById('input-preview-box');
    const previewImg = document.getElementById('input-preview');
    const btnChange = document.getElementById('btn-change-image');
    
    const btnSubmit = document.getElementById('btn-submit');
    const btnText = btnSubmit.querySelector('.btn-text');
    const spinner = document.getElementById('spinner');
    
    const statusMsg = document.getElementById('status-message');
    const resultBox = document.getElementById('result-box');
    const resId = document.getElementById('res-provenance-id');
    const resUsername = document.getElementById('res-username');
    const resHash = document.getElementById('res-image-hash');
    const outputImg = document.getElementById('output-preview');
    const btnDownload = document.getElementById('btn-download');

    // Drag and drop handling
    ['dragenter', 'dragover'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
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
            showError('Please select a valid image file (PNG, JPG, WebP).');
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
        
        const username = document.getElementById('username').value.trim();
        if (!username) {
            showError('Please enter a username or creator name.');
            return;
        }

        const embedMode = document.querySelector('input[name="embed_mode"]:checked')?.value || 'id';

        if (embedMode === 'direct_username' && username.length > 8) {
            showError(`Username "${username}" is ${username.length} characters long. Direct username embedding is limited to at most 8 characters to fit TrustMark's BCH error-correction envelope.`);
            return;
        }

        if (!imageInput.files || imageInput.files.length === 0) {
            showError('Please select an image file to watermark.');
            return;
        }

        const formData = new FormData();
        formData.append('username', username);
        formData.append('embed_mode', embedMode);
        formData.append('image', imageInput.files[0]);

        // Loading state
        setLoading(true);
        hideStatus();
        resultBox.classList.add('hidden');

        try {
            const resp = await fetch('/api/watermark', {
                method: 'POST',
                body: formData
            });

            const data = await resp.json();

            if (!resp.ok || data.error) {
                showError(data.error || 'Failed to embed watermark.');
            } else {
                // Populate result
                resId.textContent = data.provenance_id;
                resUsername.textContent = data.username;
                resHash.textContent = data.image_hash;
                outputImg.src = data.image_data;
                btnDownload.href = data.image_data;
                btnDownload.download = data.filename;

                resultBox.classList.remove('hidden');
                resultBox.scrollIntoView({ behavior: 'smooth' });
            }
        } catch (err) {
            showError('Network error or server unavailable: ' + err.message);
        } finally {
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        btnSubmit.disabled = isLoading;
        if (isLoading) {
            btnText.textContent = 'Processing & Embedding Watermark...';
            spinner.classList.remove('hidden');
        } else {
            btnText.textContent = 'Generate Provenance & Embed Watermark';
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
