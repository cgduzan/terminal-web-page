#!/usr/bin/env bash
# One-shot content deploy: sync working tree -> S3, then invalidate CloudFront.
# Reads the gitignored egg media (assets/*.gif|mp3) from the FILESYSTEM, not git,
# so the one-shot model is the whole point. Run from anywhere.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source infra/aws-env.sh >/dev/null

BUCKET="$(cd infra && pulumi stack output bucketName)"
DIST="$(cd infra && pulumi stack output distributionId)"
echo "Bucket: $BUCKET   Distribution: $DIST"

# Everything EXCEPT index.html -> long cache. infra/ is excluded so creds and the
# Pulumi program are NEVER uploaded to the public bucket.
aws s3 sync . "s3://$BUCKET" --delete \
  --exclude ".git/*" \
  --exclude ".gitignore" \
  --exclude ".vscode/*" \
  --exclude "*.md" \
  --exclude "infra/*" \
  --exclude "index.html" \
  --cache-control "public, max-age=86400"

# index.html -> no-cache so site updates appear immediately after invalidation.
aws s3 cp index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache" \
  --content-type "text/html"

aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" >/dev/null
echo "Deployed. https://cgduzan.com  (invalidation in flight, ~30-60s)"
