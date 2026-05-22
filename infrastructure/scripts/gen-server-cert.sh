#!/usr/bin/env bash
# Issue a server cert signed by the fileSync private CA.
# Usage: gen-server-cert.sh <name> <hostname1> [hostname2 ...]
#   ./gen-server-cert.sh node-a node-a.local 10.0.0.5
set -euo pipefail

NAME="${1:?usage: gen-server-cert.sh <name> <san1> [san2 ...]}"
shift
if [[ $# -lt 1 ]]; then
  echo "must provide at least one SAN (hostname or IP)" >&2
  exit 1
fi

CA_DIR="${CA_DIR:-./ca}"
OUT_DIR="${OUT_DIR:-./certs/$NAME}"
mkdir -p "$OUT_DIR"

if [[ ! -f "$CA_DIR/ca.key" || ! -f "$CA_DIR/ca.crt" ]]; then
  echo "CA not found in $CA_DIR — run gen-ca.sh first." >&2
  exit 1
fi

SAN_LINES=""
i=1
for san in "$@"; do
  if [[ "$san" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SAN_LINES+="IP.$i = $san"$'\n'
  else
    SAN_LINES+="DNS.$i = $san"$'\n'
  fi
  i=$((i + 1))
done

CONF="$OUT_DIR/openssl.cnf"
cat > "$CONF" <<EOF
[ req ]
default_bits        = 2048
prompt              = no
default_md          = sha256
distinguished_name  = dn
req_extensions      = req_ext

[ dn ]
CN = $NAME
O  = fileSync

[ req_ext ]
subjectAltName      = @alt_names
keyUsage            = critical, digitalSignature, keyEncipherment
extendedKeyUsage    = serverAuth, clientAuth

[ alt_names ]
$SAN_LINES
EOF

openssl genrsa -out "$OUT_DIR/server.key" 2048
openssl req -new -key "$OUT_DIR/server.key" -out "$OUT_DIR/server.csr" -config "$CONF"
openssl x509 -req \
  -in "$OUT_DIR/server.csr" \
  -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -out "$OUT_DIR/server.crt" \
  -days 825 -sha256 \
  -extensions req_ext -extfile "$CONF"

cp "$CA_DIR/ca.crt" "$OUT_DIR/ca.crt"
chmod 600 "$OUT_DIR/server.key"
rm "$OUT_DIR/server.csr"

echo "Issued cert for $NAME in $OUT_DIR"
echo "  - server.crt (cert)"
echo "  - server.key (private key, 600)"
echo "  - ca.crt     (trust anchor — same on every node)"
