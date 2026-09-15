import base64
import binascii
import uuid

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

MAX_LOGO_BYTES = 5_000_000
MAX_LOGO_DATA_URL_LENGTH = 7_000_000


class ImageStorageError(Exception):
    pass


def _extension(content_type):
    return {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
    }.get(content_type)


def store_logo(data_url, business_slug):
    """Upload a data URL to R2, or keep it inline when R2 is not configured."""
    if not data_url or not settings.R2_BUCKET_NAME:
        return data_url
    if not settings.R2_PUBLIC_URL:
        raise ImageStorageError('R2_PUBLIC_URL is required when R2 storage is enabled')
    try:
        header, encoded = data_url.split(',', 1)
        content_type = header.split(';', 1)[0].removeprefix('data:')
        extension = _extension(content_type)
        if not extension or not header.startswith('data:image/'):
            raise ImageStorageError('Logo must be a PNG, JPG, or WebP image')
        payload = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ImageStorageError('Logo image data is invalid') from exc
    if len(payload) > MAX_LOGO_BYTES:
        raise ImageStorageError('Logo must be smaller than 5 MB')

    key = f'logos/{business_slug}/{uuid.uuid4().hex}.{extension}'
    try:
        client = boto3.client(
            's3',
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name='auto',
        )
        client.put_object(
            Bucket=settings.R2_BUCKET_NAME,
            Key=key,
            Body=payload,
            ContentType=content_type,
            CacheControl='public, max-age=31536000, immutable',
        )
    except (BotoCoreError, ClientError) as exc:
        raise ImageStorageError('Could not save the logo to Cloudflare storage') from exc
    return f"{settings.R2_PUBLIC_URL.rstrip('/')}/{key}"