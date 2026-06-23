#!/bin/sh
# Substitute Vercel env vars into the static HTML at build time.
# SUPABASE_URL and SUPABASE_ANON_KEY must be set in Vercel project settings.
set -e
mkdir -p dist
sed \
  -e "s|__SUPABASE_URL__|${SUPABASE_URL}|g" \
  -e "s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY}|g" \
  index.html > dist/index.html
