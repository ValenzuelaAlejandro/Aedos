#!/bin/bash
# scripts/sync-env-urls.sh

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Fallback values
FRONTEND_URL=${FRONTEND_URL:-"https://aedoslab.xyz"}
BACKEND_URL=${BACKEND_URL:-"https://aedos.onrender.com"}

echo "Syncing URLs: FRONTEND=$FRONTEND_URL, BACKEND=$BACKEND_URL"

# 1. Update index.html meta tags
INDEX_HTML="src/frontend/pages/index.html"
if [ -f "$INDEX_HTML" ]; then
  # Replace Render URL with FRONTEND_URL in meta tags (OG and Twitter)
  sed -i "s|https://aedos.onrender.com|$FRONTEND_URL|g" "$INDEX_HTML"
  echo "Updated $INDEX_HTML meta tags"
fi

# 2. Update vercel.json destination
VERCEL_JSON="vercel.json"
if [ -f "$VERCEL_JSON" ]; then
  sed -i "s|https://aedos.onrender.com|$BACKEND_URL|g" "$VERCEL_JSON"
  echo "Updated $VERCEL_JSON destination"
fi
