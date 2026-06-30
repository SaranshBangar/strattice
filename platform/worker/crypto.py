"""AES-256-GCM for CoinDCX API keys at rest. Symmetric, shared with the Next.js app.

Token format (base64):  nonce(12 bytes) || ciphertext || tag(16 bytes)
This is exactly what Node's WebCrypto produces for AES-GCM (it appends the tag to the
ciphertext), so the Next.js side can encrypt/decrypt the same blobs — see decrypt() doc.

Master key: env ENCRYPTION_MASTER_KEY = base64 of 32 raw bytes (256-bit). Generate once:
    python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"
Keep it out of the DB. Decrypt only in memory, at trade time. Never log plaintext keys.
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE = 12


def _key() -> bytes:
    raw = os.getenv("ENCRYPTION_MASTER_KEY", "")
    if not raw:
        raise RuntimeError("ENCRYPTION_MASTER_KEY not set")
    k = base64.b64decode(raw)
    if len(k) != 32:
        raise RuntimeError(f"ENCRYPTION_MASTER_KEY must decode to 32 bytes, got {len(k)}")
    return k


def encrypt(plaintext: str) -> str:
    nonce = os.urandom(_NONCE)
    ct = AESGCM(_key()).encrypt(nonce, plaintext.encode(), None)  # ct includes the 16-byte tag
    return base64.b64encode(nonce + ct).decode()


def decrypt(token: str) -> str:
    """Inverse of encrypt(). To produce/read these in Node:
        // encrypt: const buf = new Uint8Array([...iv, ...new Uint8Array(ciphertextWithTag)]);
        //          base64(buf)   where ciphertextWithTag = crypto.subtle.encrypt({name:'AES-GCM',iv})
        // decrypt: split first 12 bytes as iv, rest -> subtle.decrypt
    """
    blob = base64.b64decode(token)
    nonce, ct = blob[:_NONCE], blob[_NONCE:]
    return AESGCM(_key()).decrypt(nonce, ct, None).decode()


if __name__ == "__main__":
    # self-check: round-trip + tamper detection. Uses a throwaway key so it needs no env.
    os.environ["ENCRYPTION_MASTER_KEY"] = base64.b64encode(os.urandom(32)).decode()
    secret = "abc123_coindcx_secret_key"
    tok = encrypt(secret)
    assert decrypt(tok) == secret, "round-trip failed"
    assert tok != encrypt(secret), "nonce must randomize ciphertext"
    bad = base64.b64encode(base64.b64decode(tok)[:-1] + b"\x00").decode()
    try:
        decrypt(bad)
        raise SystemExit("tamper not detected")
    except Exception as e:
        assert "SystemExit" not in type(e).__name__
    print("crypto self-check OK")
