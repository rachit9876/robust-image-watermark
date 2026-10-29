import io
import unittest
from PIL import Image
from app import app
from db import init_db, find_watermark_record

class WatermarkAppTestCase(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = app.test_client()

    def test_pages_load(self):
        # Page 1
        res1 = self.client.get('/')
        self.assertEqual(res1.status_code, 200)
        self.assertIn(b'Watermark Image', res1.data)

        # Page 2
        res2 = self.client.get('/detector')
        self.assertEqual(res2.status_code, 200)
        self.assertIn(b'Watermark Detector', res2.data)

    def test_watermark_embed_and_detect_flow(self):
        # 1. Create a synthetic test image in memory
        img = Image.new('RGB', (256, 256), color=(100, 150, 200))
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)

        # 2. Call /api/watermark to embed provenance
        resp = self.client.post('/api/watermark', data={
            'username': 'test_creator',
            'image': (io.BytesIO(img_bytes.getvalue()), 'sample.png')
        }, content_type='multipart/form-data')

        self.assertEqual(resp.status_code, 200)
        json_data = resp.get_json()
        self.assertTrue(json_data['success'])
        prov_id = json_data['provenance_id']
        self.assertEqual(len(prov_id), 8)
        self.assertEqual(json_data['username'], 'test_creator')

        # 3. Verify SQLite stored it
        record = find_watermark_record(prov_id)
        self.assertIsNotNone(record)
        self.assertEqual(record['username'], 'test_creator')

        # 4. Extract watermarked image data from base64
        import base64
        b64_str = json_data['image_data'].split(',')[1]
        watermarked_bytes = base64.b64decode(b64_str)

        # 5. Detect watermark with /api/detect
        detect_resp = self.client.post('/api/detect', data={
            'image': (io.BytesIO(watermarked_bytes), 'watermarked.png')
        }, content_type='multipart/form-data')

        self.assertEqual(detect_resp.status_code, 200)
        detect_json = detect_resp.get_json()
        self.assertEqual(detect_json['status'], 'Verified')
        self.assertEqual(detect_json['username'], 'test_creator')
        self.assertEqual(detect_json['recovered_id'], prov_id)

    def test_detect_unwatermarked_image(self):
        img = Image.new('RGB', (200, 200), color=(250, 250, 250))
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)

        detect_resp = self.client.post('/api/detect', data={
            'image': (img_bytes, 'blank.png')
        }, content_type='multipart/form-data')

        self.assertEqual(detect_resp.status_code, 200)
        detect_json = detect_resp.get_json()
        # Should be Inconclusive or Unknown, definitely not Verified
        self.assertIn(detect_json['status'], ['Inconclusive', 'Unknown'])

if __name__ == '__main__':
    unittest.main()
