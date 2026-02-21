#!/usr/bin/env sh
set -e

# Check required environment variables
: "${API_URL:?API_URL is required}"
: "${DEF_LANG:?DEF_LANG is required}"

# Generate env.js from environment variables
cat <<EOF >/usr/share/nginx/html/env.js
window.__ENV__ = {
    API_URL: "${API_URL}",
    DEF_LANG: "${DEF_LANG}"
};
EOF

# Start nginx
exec nginx -g 'daemon off;'