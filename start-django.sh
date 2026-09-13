#!/bin/sh
# Start the Django dev API on 127.0.0.1:8000, detached.
cd "$(dirname "$0")"
exec .venv/bin/python manage.py runserver 127.0.0.1:8000 --noreload
