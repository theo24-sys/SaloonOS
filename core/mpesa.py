"""Safaricom Daraja client: OAuth token + STK push (M-Pesa Express / Lipa na M-Pesa Online).

Stdlib only (urllib) — no new dependencies. Credentials come exclusively from
settings (env vars); nothing is hardcoded. A module-level cache keeps the OAuth
token warm across requests; the lock avoids stampedes on cold instances.
"""
import base64
import json
import threading
import time
from datetime import datetime
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from django.conf import settings


class DarajaError(Exception):
    """Raised for any Daraja API failure (network, auth, or business rejection)."""


_token_cache = {'token': None, 'expires_at': 0.0}
_lock = threading.Lock()


def _password():
    """Base64 of shortcode + passkey + timestamp (Daraja STK spec)."""
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    raw = f"{settings.MPESA_SHORTCODE}{settings.MPESA_PASSKEY}{timestamp}"
    return base64.b64encode(raw.encode()).decode(), timestamp


def _http_json(url, payload=None, headers=None, timeout=15):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urlrequest.Request(url, data=body, method='POST' if body else 'GET')
    req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        detail = e.read().decode(errors='replace')[:300]
        raise DarajaError(f"Daraja HTTP {e.code}: {detail}") from e
    except (URLError, TimeoutError, OSError) as e:
        raise DarajaError(f"Daraja unreachable: {e}") from e


def access_token():
    """Fetch (and cache) an OAuth token from Daraja."""
    with _lock:
        if _token_cache['token'] and time.time() < _token_cache['expires_at']:
            return _token_cache['token']
        if not (settings.MPESA_CONSUMER_KEY and settings.MPESA_CONSUMER_SECRET):
            raise DarajaError('MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not configured')
        creds = base64.b64encode(
            f"{settings.MPESA_CONSUMER_KEY}:{settings.MPESA_CONSUMER_SECRET}".encode()
        ).decode()
        data = _http_json(
            f"{settings.MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials",
            headers={'Authorization': f'Basic {creds}'},
        )
        _token_cache['token'] = data['access_token']
        # expire a minute early for safety
        _token_cache['expires_at'] = time.time() + int(data.get('expires_in', 3599)) - 60
        return _token_cache['token']


def normalize_phone(raw):
    """Accept 07.., 01.., 2547.., +2547.. — return 2547XXXXXXXX or raise."""
    d = ''.join(ch for ch in str(raw) if ch.isdigit())
    if d.startswith('0') and len(d) == 10:
        d = '254' + d[1:]
    elif d.startswith('254') and len(d) == 12:
        pass
    elif len(d) == 9:
        d = '254' + d
    else:
        raise DarajaError('Phone must be a Kenyan number, e.g. 0712345678')
    if not (d.startswith('2547') or d.startswith('2541')):
        raise DarajaError('Only Safaricom numbers (07xx / 01xx) can pay via STK push')
    return d


def stk_push(phone, amount, account_reference, description, callback_url):
    """Send an STK push. Returns (checkout_request_id, merchant_request_id).
    With MPESA_SIMULATE=1 no real request is made; a fake ID is returned."""
    msisdn = normalize_phone(phone)
    amount = int(amount)
    if amount < 1:
        raise DarajaError('Amount must be at least KSh 1')

    if settings.MPESA_SIMULATE:
        return f'SIM-{msisdn}-{int(time.time())}', 'SIM-MR-0000'

    password, timestamp = _password()
    data = _http_json(
        f"{settings.MPESA_BASE}/mpesa/stkpush/v1/processrequest",
        payload={
            'BusinessShortCode': settings.MPESA_SHORTCODE,
            'Password': password,
            'Timestamp': timestamp,
            'TransactionType': 'CustomerPayBillOnline',
            'Amount': amount,
            'PartyA': msisdn,
            'PartyB': settings.MPESA_SHORTCODE,
            'PhoneNumber': msisdn,
            'CallBackURL': callback_url,
            'AccountReference': account_reference[:12],
            'TransactionDesc': description[:13],
        },
        headers={'Authorization': f'Bearer {access_token()}'},
    )
    if data.get('ResponseCode') != '0':
        raise DarajaError(data.get('errorMessage') or f"STK rejected: {data}")
    return data['CheckoutRequestID'], data['MerchantRequestID']


def stk_query(checkout_request_id):
    """Ask Daraja about a push. Returns the ResultCode as a string ('0' = success),
    'PENDING' while the customer hasn't acted, or raises on real errors."""
    if settings.MPESA_SIMULATE:
        return 'PENDING'
    password, timestamp = _password()
    data = _http_json(
        f"{settings.MPESA_BASE}/mpesa/stkpushquery/v1/query",
        payload={
            'BusinessShortCode': settings.MPESA_SHORTCODE,
            'Password': password,
            'Timestamp': timestamp,
            'CheckoutRequestID': checkout_request_id,
        },
        headers={'Authorization': f'Bearer {access_token()}'},
    )
    if data.get('errorCode'):
        # 500.001.1001 = "The transaction is being processed" → still pending
        if data['errorCode'] == '500.001.1001':
            return 'PENDING'
        raise DarajaError(data.get('errorMessage') or f"Query rejected: {data}")
    return str(data.get('ResultCode'))
