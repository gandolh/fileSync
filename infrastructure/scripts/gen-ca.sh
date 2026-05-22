#!/usr/bin/env bash
# Generate the private CA used to sign every fileSync server cert.
# Run once. Keep ca.key offline / out of the repo.
set -euo pipefail

OUT_DIR="${1:-./ca}"
mkdir -p "$OUT_DIR"

if [[ -f "$OUT_DIR/ca.key" ]]; then
  echo "CA already exists at $OUT_DIR/ca.key — refusing to overwrite." >&2
  exit 1
fi

openssl genrsa -out "$OUT_DIR/ca.key" 4096
openssl req -x509 -new -nodes \
  -key "$OUT_DIR/ca.key" \
  -sha256 -days 3650 \
  -subj "/CN=fileSync Private CA/O=fileSync" \
  -out "$OUT_DIR/ca.crt"

chmod 600 "$OUT_DIR/ca.key"
echo "CA created at $OUT_DIR/ca.crt (key: $OUT_DIR/ca.key)"
