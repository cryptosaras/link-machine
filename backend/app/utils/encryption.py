import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings


def _get_key() -> bytes:
    raw = settings.ENCRYPTION_KEY
    if not raw:
        raise RuntimeError("ENCRYPTION_KEY is not configured. Set it in your .env file.")
    key = base64.b64decode(raw)
    if len(key) not in (16, 24, 32):
        raise RuntimeError(f"ENCRYPTION_KEY must decode to 16, 24, or 32 bytes, got {len(key)}")
    return key


def encrypt(plaintext: str) -> bytes:
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return nonce + ciphertext


def decrypt(data: bytes) -> str:
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = data[:12]
    ciphertext = data[12:]
    return aesgcm.decrypt(nonce, ciphertext, None).decode()
