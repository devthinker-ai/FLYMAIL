#!/usr/bin/env bash
# download_data.sh — fetch the MaleCNS v1.0 flat connectome (3 feathers, ~1.2 GB)
# into data/raw/ with sha256 verification against the pinned provenance.
#
# Sources (Janelia flat-connectome release, CC BY 4.0):
#   annotations + neurotransmitters + synapse-contact edges (minconf 0.5).
# Pinned hashes: ../doomfly/data-provenance/malecns_v1/source.lock.json
#
# Usage:  bash tools/download_data.sh
#   Downloads are staged to .part, verified, then moved to data/raw/.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p data/raw
RAW=data/raw

# name|url|sha256|expected_bytes
FILES=(
  "annotations.feather|https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-annotations-male-cns-v1.0-minconf-0.5.feather|2177e246113e4cfbf1e7772ec37c6da1955ff22e8063d0b1f833101f99a9a3b2|14483314"
  "neurotransmitters.feather|https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-neurotransmitters-male-cns-v1.0.feather|95c9289220663abeb3409f3ad9e5a7f8a53f8093f5139d15502cd08da8879621|43282834"
  "edges.feather|https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/connectome-weights-male-cns-v1.0-minconf-0.5.feather|e35da783d1c686b2b58b3b87cd6a403ae43bfcfba8bff28e08ef752c1a56afc1|1051241946"
)

for entry in "${FILES[@]}"; do
  IFS='|' read -r name url sha bytes <<< "$entry"
  dest="$RAW/$name"
  if [[ -f "$dest" ]] && shasum -a 256 -c <(echo "$sha  $dest") 2>/dev/null; then
    echo "OK (cached): $name"
    continue
  fi
  echo "Downloading $name ($(( bytes / 1024 / 1024 )) MB)…"
  curl -fSL --retry 3 -C - -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
  actual_bytes=$(stat -f%z "$dest")
  if [[ "$actual_bytes" != "$bytes" ]]; then
    echo "FAIL: $name size $actual_bytes != $bytes" >&2
    rm -f "$dest"
    exit 1
  fi
  if ! shasum -a 256 -c <(echo "$sha  $dest") 2>/dev/null; then
    echo "FAIL: $name sha256 mismatch" >&2
    rm -f "$dest"
    exit 1
  fi
  echo "VERIFIED: $name"
done

echo "All MaleCNS v1.0 sources verified in data/raw/."
ls -lh "$RAW"
