#!/usr/bin/env bash
# Start the Next.js dev server (used so shell commands never contain the
# process name directly, e.g. when pkill needs to target it).
cd "$(dirname "$0")/frontend"
exec npx next dev -p 3000
