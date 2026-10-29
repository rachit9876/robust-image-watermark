import hashlib
import io
import secrets
import string
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

def detect_watermark(image: Image.Image, model_type: str = 'Q') -> dict:
    """
    Attempt to extract watermark payload from a PIL image.
    Returns:
        dict: {
            "success": bool,
            "raw_payload": str,
            "provenance_id": str,
            "version": int,
            "details": str
        }
    """
    tm = get_trustmark_instance(model_type=model_type, use_ECC=True)
    rgb_image = image.convert("RGB")
    try:
        secret_pred, detected, version = tm.decode(rgb_image, MODE='text', ROTATION=False)
        cleaned_secret = secret_pred.strip().replace("\x00", "") if secret_pred else ""
        
        return {
            "success": bool(detected and cleaned_secret),
            "raw_payload": secret_pred,
            "provenance_id": cleaned_secret,
            "version": version,
            "details": f"Detection: {detected}, Schema version: {version}"
        }
    except Exception as e:
        return {
            "success": False,
            "raw_payload": "",
            "provenance_id": "",
            "version": -1,
            "details": f"Error during decoding: {str(e)}"
        }
