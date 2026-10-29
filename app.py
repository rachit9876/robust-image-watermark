import os
import io
import base64
from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image

from db import init_db, save_watermark_record, find_watermark_record
from watermark import generate_provenance_id, compute_image_hash, embed_watermark, detect_watermark

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32MB max upload limit

# Initialize SQLite database schema
init_db()

@app.route('/')
def page_watermark():
    """Page 1 — Embed Watermark UI"""
    return render_template('watermark.html')

@app.route('/detector')
def page_detector():
    """Page 2 — Detect Watermark UI"""
    return render_template('detector.html')

@app.route('/api/watermark', methods=['POST'])
def api_watermark():
    username = request.form.get('username', '').strip()
    embed_mode = request.form.get('embed_mode', 'id').strip()  # 'id' or 'direct_username'
    file = request.files.get('image')

    if not username:
        return jsonify({'error': 'Username is required'}), 400
    if not file or file.filename == '':
        return jsonify({'error': 'Image file is required'}), 400

    if embed_mode == 'direct_username' and len(username) > 8:
        return jsonify({'error': f'Username "{username}" is {len(username)} characters. Direct username embedding is limited to at most 8 characters to fit TrustMark error-correction payload limits.'}), 400

    try:
        raw_bytes = file.read()
        image_hash = compute_image_hash(raw_bytes)
        
        # Open and validate image
        pil_img = Image.open(io.BytesIO(raw_bytes))
        
        # Determine payload string based on embed_mode
        if embed_mode == 'direct_username':
            provenance_id = username  # Direct username embedding (up to 8 chars)
        else:
            provenance_id = generate_provenance_id(length=8)  # Default random ID
        
        # Embed watermark using TrustMark with BCH_5 ECC
        watermarked_pil = embed_watermark(pil_img, provenance_id, model_type='Q', wm_strength=1.0)
        
        # Save record in SQLite
        save_watermark_record(
            provenance_id=provenance_id,
            username=username,
            original_image_hash=image_hash,
            model_type='Q',
            ecc_scheme='BCH_5'
        )
        
        # Output as PNG in memory (lossless format for downloading and preview)
        buf = io.BytesIO()
        watermarked_pil.save(buf, format='PNG')
        buf.seek(0)
        base64_data = base64.b64encode(buf.getvalue()).decode('utf-8')
        
        return jsonify({
            'success': True,
            'provenance_id': provenance_id,
            'username': username,
            'embed_mode': embed_mode,
            'image_hash': image_hash,
            'image_data': f'data:image/png;base64,{base64_data}',
            'filename': f'watermarked_{provenance_id}.png'
        })
    except Exception as e:
        return jsonify({'error': f'Failed to watermark image: {str(e)}'}), 500

@app.route('/api/detect', methods=['POST'])
def api_detect():
    file = request.files.get('image')
    if not file or file.filename == '':
        return jsonify({'error': 'Image file is required'}), 400

    try:
        raw_bytes = file.read()
        pil_img = Image.open(io.BytesIO(raw_bytes))
        
        # Attempt to decode watermark
        detection_result = detect_watermark(pil_img, model_type='Q')
        
        if not detection_result['success'] or not detection_result['provenance_id']:
            return jsonify({
                'status': 'Inconclusive',
                'message': 'No detectable watermark payload could be decoded from the image.',
                'recovered_id': None,
                'record': None
            })
            
        recovered_id = detection_result['provenance_id']
        record = find_watermark_record(recovered_id)
        
        if record:
            return jsonify({
                'status': 'Verified',
                'username': record['username'],
                'recovered_id': recovered_id,
                'record': {
                    'username': record['username'],
                    'provenance_id': record['provenance_id'],
                    'original_image_hash': record['original_image_hash'],
                    'created_at': record['created_at'],
                    'ecc_scheme': record['ecc_scheme']
                }
            })
        else:
            return jsonify({
                'status': 'Unknown',
                'message': f'Decoded payload "{recovered_id}", but no matching record was found in the database.',
                'recovered_id': recovered_id,
                'record': None
            })
    except Exception as e:
        return jsonify({
            'status': 'Inconclusive',
            'message': f'Decoding failed: {str(e)}',
            'recovered_id': None,
            'record': None
        })

if __name__ == '__main__':
    print("Starting TrustMark Watermarking Server on http://127.0.0.1:5000 ...")
    app.run(host='127.0.0.1', port=5000, debug=False)
