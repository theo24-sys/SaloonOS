"""
Django settings for ServiceProof.
All deployment-specific values come from environment variables; defaults
match the local dev setup so `manage.py runserver` works unchanged.
"""
import os
from pathlib import Path
from urllib.parse import urlparse, unquote

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env(key, default=''):
    return os.environ.get(key, default).strip()


SECRET_KEY = env('SECRET_KEY', 'dev-only-serviceproof-secret-key-change-me')
ADMIN_KEY = env('ADMIN_KEY', 'saloonos-master-2026')
DEBUG = env('DEBUG', '1') not in ('0', 'false', 'False')
ALLOWED_HOSTS = [h for h in env('ALLOWED_HOSTS', '*').split(',') if h]

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'core',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {'context_processors': []},
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

def _db_from_url(url):
    """Parse a postgres:// or sqlite:// DATABASE_URL into Django settings (no extra deps).
    User/password are URL-unquoted so hosted pooler strings like
    postgresql://postgres.abc:P%40ss@host:5432/postgres work as pasted."""
    if url.startswith('sqlite'):
        path = url.replace('sqlite:///', '').replace('sqlite://', '')
        return {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / path if path and path != ':memory:' else ':memory:',
        }
    u = urlparse(url)
    return {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': unquote(u.path.lstrip('/')),
        'USER': unquote(u.username or ''),
        'PASSWORD': unquote(u.password or ''),
        'HOST': u.hostname or '',
        'PORT': u.port or 5432,
        'CONN_MAX_AGE': 60,
        'OPTIONS': {'sslmode': 'require'} if u.hostname not in ('localhost', '127.0.0.1') else {},
    }


if env('DATABASE_URL'):
    DATABASES = {'default': _db_from_url(env('DATABASE_URL'))}
elif DEBUG:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': env('DB_NAME', 'serviceproof'),
            'USER': env('DB_USER', 'serviceproof'),
            'PASSWORD': env('DB_PASSWORD', 'sp_dev_2026'),
            'HOST': env('DB_HOST', '127.0.0.1'),
            'PORT': env('DB_PORT', '5432'),
            'CONN_MAX_AGE': 60,
        }
    }
else:
    # In production, silently dialing localhost wastes a whole deploy cycle —
    # crash at startup with the actual fix in the message.
    raise ImproperlyConfigured(
        'DATABASE_URL is required when DEBUG=0. Set it on the service '
        '(Render: Environment → Add Environment Variable) to your hosted '
        'Postgres URL, e.g. the Supabase session-pooler connection string '
        '(port 5432, real password substituted).'
    )

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Africa/Nairobi'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOWED_ORIGINS = [o for o in env(
    'CORS_ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000'
).split(',') if o]
CORS_ALLOW_HEADERS = ['content-type', 'x-sp-business', 'x-sp-pin', 'x-sp-staff-token', 'x-sp-public-origin']

REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
}

# Public base URL encoded into QR codes — set to your deployed frontend URL
# (or LAN address for local phone testing) or customers can't scan.
PUBLIC_BASE_URL = env('PUBLIC_BASE_URL', 'http://localhost:3000')

# --- M-Pesa (Daraja) — salon owners paying for their subscription -----------
MPESA_CONSUMER_KEY = env('MPESA_CONSUMER_KEY')
MPESA_CONSUMER_SECRET = env('MPESA_CONSUMER_SECRET')
MPESA_PASSKEY = env('MPESA_PASSKEY')
MPESA_SHORTCODE = env('MPESA_SHORTCODE')
MPESA_TRANSACTION_TYPE = env('MPESA_TRANSACTION_TYPE', 'CustomerPayBillOnline')
MPESA_ENVIRONMENT = env('MPESA_ENVIRONMENT', 'sandbox')  # sandbox | production
MPESA_BASE = ('https://api.safaricom.co.ke' if MPESA_ENVIRONMENT == 'production'
              else 'https://sandbox.safaricom.co.ke')
# Daraja needs a reachable callback URL. Render services get RENDER_EXTERNAL_URL
# automatically; override with MPESA_CALLBACK_URL if proxying differently.
MPESA_CALLBACK_URL = env('MPESA_CALLBACK_URL') or (
    env('RENDER_EXTERNAL_URL').rstrip('/') + '/api/mpesa/callback/'
    if env('RENDER_EXTERNAL_URL') else '')
# Optional shared secret appended by Daraja callers (?token=...) to gate callbacks.
MPESA_CALLBACK_TOKEN = env('MPESA_CALLBACK_TOKEN')
# Lets local dev run the whole STK flow without real Daraja keys.
MPESA_SIMULATE = env('MPESA_SIMULATE', '1' if DEBUG else '0') in ('1', 'true', 'True')
