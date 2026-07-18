"""AES-256-GCM for CoinDCX API keys at rest. Symmetric, shared with the Next.js app.

Token format (base64):  nonce(12 bytes) || ciphertext || tag(16 bytes)
This is exactly what Node's WebCrypto produces for AES-GCM (it appends the tag to the
ciphertext), so the Next.js side can encrypt/decrypt the same blobs — see decrypt() doc.

Master key: env ENCRYPTION_MASTER_KEY = base64 of 32 raw bytes (256-bit). Generate once:
    python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"
Keep it out of the DB. Decrypt only in memory, at trade time. Never log plaintext keys.

Key rotation: set the NEW key in ENCRYPTION_MASTER_KEY and the OLD one in
ENCRYPTION_MASTER_KEY_PREVIOUS. decrypt() tries current-then-previous, encrypt() always
uses current, and reencrypt() re-wraps an old token under the current key - so a rotation
is: set both envs, run reencrypt() over stored tokens (or let them lazily re-wrap), then
drop the _PREVIOUS var. Token format is unchanged, so the Node side needs nothing new.
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE = 12


def _load_key(env_var: str) -> bytes:
    raw = os.getenv(env_var, "")
    if not raw:
        raise RuntimeError(f"{env_var} not set")
    k = base64.b64decode(raw)
    if len(k) != 32:
        raise RuntimeError(f"{env_var} must decode to 32 bytes, got {len(k)}")
    return k


def _key() -> bytes:
    return _load_key("ENCRYPTION_MASTER_KEY")


def _keys_for_decrypt() -> list[bytes]:
    """Current key first, then the previous one during a rotation window (if set)."""
    keys = [_key()]
    if os.getenv("ENCRYPTION_MASTER_KEY_PREVIOUS"):
        keys.append(_load_key("ENCRYPTION_MASTER_KEY_PREVIOUS"))
    return keys


def encrypt(plaintext: str) -> str:
    nonce = os.urandom(_NONCE)
    ct = AESGCM(_key()).encrypt(nonce, plaintext.encode(), None)  # ct includes the 16-byte tag
    return base64.b64encode(nonce + ct).decode()


def decrypt(token: str) -> str:
    """Inverse of encrypt(). To produce/read these in Node:
        // encrypt: const buf = new Uint8Array([...iv, ...new Uint8Array(ciphertextWithTag)]);
        //          base64(buf)   where ciphertextWithTag = crypto.subtle.encrypt({name:'AES-GCM',iv})
        // decrypt: split first 12 bytes as iv, rest -> subtle.decrypt
    Tries the current master key, then ENCRYPTION_MASTER_KEY_PREVIOUS (rotation window).
    """
    blob = base64.b64decode(token)
    nonce, ct = blob[:_NONCE], blob[_NONCE:]
    last_err: Exception | None = None
    for k in _keys_for_decrypt():
        try:
            return AESGCM(k).decrypt(nonce, ct, None).decode()
        except Exception as e:  # InvalidTag under the wrong key - try the next one
            last_err = e
    raise last_err  # type: ignore[misc]


def reencrypt(token: str) -> str:
    """Re-wrap a token under the CURRENT master key (decrypts via current-or-previous).
    Idempotent in effect: the plaintext is unchanged, only the wrapping key/nonce move."""
    return encrypt(decrypt(token))


if __name__ == "__main__":
    # self-check: round-trip + tamper detection. Uses a throwaway key so it needs no env.
    os.environ["ENCRYPTION_MASTER_KEY"] = base64.b64encode(os.urandom(32)).decode()
    os.environ.pop("ENCRYPTION_MASTER_KEY_PREVIOUS", None)
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

    # rotation: token written under the OLD key still decrypts once the key moves to
    # _PREVIOUS, and reencrypt() re-wraps it under the new one.
    old_key = os.environ["ENCRYPTION_MASTER_KEY"]
    tok_old = encrypt(secret)
    os.environ["ENCRYPTION_MASTER_KEY"] = base64.b64encode(os.urandom(32)).decode()
    os.environ["ENCRYPTION_MASTER_KEY_PREVIOUS"] = old_key
    assert decrypt(tok_old) == secret, "rotation: old-key token must decrypt via _PREVIOUS"
    tok_new = reencrypt(tok_old)
    os.environ.pop("ENCRYPTION_MASTER_KEY_PREVIOUS")
    assert decrypt(tok_new) == secret, "re-wrapped token must decrypt with current key alone"
    try:
        decrypt(tok_old)
        raise SystemExit("old token must NOT decrypt after _PREVIOUS is dropped")
    except Exception as e:
        assert "SystemExit" not in type(e).__name__
    print("crypto self-check OK (round-trip, tamper, rotation)")
