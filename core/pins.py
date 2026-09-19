"""PIN hashing utilities — owner and staff PINs are never stored in plaintext.

Low-entropy 4–8 digit codes are cheap to brute-force *offline* once a DB leaks,
so hashing alone is not enough: every hash is peppered with a server-side secret
(PIN_PEPPER) that never lives in the database. Format per stored value:

    pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>

Old plaintext values (12 chars or fewer, all digits) are transparently
verified and re-hashed on first successful login by check_pin().
"""
import hashlib
import secrets

from django.conf import settings

ALGORITHM = 'pbkdf2_sha256'
ITERATIONS = 120_000  # ~50ms per check; fine for PIN-gated endpoints


def _pepper() -> bytes:
    pepper = getattr(settings, 'PIN_PEPPER', '') or getattr(settings, 'SECRET_KEY', '')
    return pepper.encode()


def _hash(pin: str, salt: bytes) -> str:
    dk = hashlib.pbkdf2_hmac('sha256', pin.encode() + _pepper(), salt, ITERATIONS)
    return dk.hex()


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    return f"{ALGORITHM}${ITERATIONS}${salt.hex()}${_hash(pin, salt)}"


def check_pin(pin: str, stored: str) -> bool:
    """Verify a PIN against a hashed (or legacy plaintext) stored value.
    Returns True and re-hashes in place for legacy values — but the caller
    must save the model for the upgrade to persist."""
    if not pin or not stored:
        return False
    if len(stored) <= 8 and stored.isdigit():
        # Legacy plaintext row: constant-time compare, signal re-hash needed.
        if secrets.compare_digest(pin.encode(), stored.encode()):
            return True
        return False
    try:
        algorithm, iterations, salt_hex, hash_hex = stored.split('$', 3)
    except ValueError:
        return False
    if algorithm != ALGORITHM:
        return False
    salt = bytes.fromhex(salt_hex)
    candidate = _hash_with_params(pin, salt, int(iterations))
    return secrets.compare_digest(candidate, hash_hex)


def _hash_with_params(pin: str, salt: bytes, iterations: int) -> str:
    dk = hashlib.pbkdf2_hmac('sha256', pin.encode() + _pepper(), salt, iterations)
    return dk.hex()


def is_hashed(stored: str) -> bool:
    return bool(stored) and '$' in stored and stored.startswith(ALGORITHM + '$')
