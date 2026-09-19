"""Per-identity rate limiting for the brute-forceable endpoints.

Uses the default cache (LocMem in dev; add Redis/memcached in production for
cross-process counts) to track consecutive failures per identity. Callers must
validate credentials FIRST, then record failures — only failures count toward
lockout, so legitimate users are never throttled. All failures within the
window count; the lockout resets when an attempt succeeds.
"""
import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)

# name: (max failures, window seconds, lockout seconds)
LIMITS = {
    'login': (10, 300, 300),      # owner-login identifier+PIN guesses
    'pin': (10, 300, 300),        # PIN-gated endpoints per business slug
    'signup': (20, 3600, 900),    # business creation per IP
    'bill_code': (120, 300, 300)  # public bill-code enumeration per IP
}


def _bucket(kind, identity):
    max_f, window, lockout = LIMITS[kind]
    key = f"rl:{kind}:{identity}"
    data = cache.get(key)
    if data is None:
        return {'key': key, 'count': 0, 'max': max_f,
                'window': window, 'lockout': lockout, 'locked_until': 0}
    return {'key': key, 'count': data[0], 'max': max_f,
            'window': window, 'lockout': lockout, 'locked_until': data[1]}


def check(kind, identity):
    """Raise PermissionDenied-style signal (returns seconds remaining) if locked."""
    import time
    b = _bucket(kind, str(identity))
    now = time.time()
    if b['locked_until'] > now:
        return int(b['locked_until'] - now) + 1
    return 0


def record_failure(kind, identity):
    """Count one failure; lock the identity when the limit is hit."""
    import time
    b = _bucket(kind, str(identity))
    now = time.time()
    count = b['count'] + 1
    if count >= b['max']:
        cache.set(b['key'], (count, now + b['lockout']), b['window'] + b['lockout'])
        logger.warning("ratelimit_locked kind=%s identity=%s failures=%d",
                       kind, _safe(identity), count)
    else:
        cache.set(b['key'], (count, 0), b['window'])
    return count


def reset(kind, identity):
    cache.delete(f"rl:{kind}:{str(identity)}")


def _safe(identity):
    """Never log full credentials — keep the last 4 chars."""
    s = str(identity)
    return s[-4:] if len(s) > 4 else '***'
