#!/usr/bin/env bash
# Builds the ITU-R-HF (ITURHFProp / P533 / P372) suite natively with gcc.
#
# This is a reference build: it proves the vendored C source compiles and
# runs correctly on the host, and it gives us native output to diff the
# WASM build's output against.
#
# Source: https://github.com/ITU-R-Study-Group-3/ITU-R-HF
# License: per the project README, the software "may be used by
# implementers ... free from any copyright assertions" (ITU-R Study Group 3,
# 2022), provided "as is" with no warranty.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
SRC_DIR="${BUILD_DIR}/ITU-R-HF"
REPO_URL="https://github.com/ITU-R-Study-Group-3/ITU-R-HF.git"

mkdir -p "${BUILD_DIR}"

if [ ! -d "${SRC_DIR}" ]; then
  echo "==> Cloning ${REPO_URL}"
  git clone --depth 1 "${REPO_URL}" "${SRC_DIR}"
else
  echo "==> Source already present at ${SRC_DIR}, skipping clone"
fi

echo "==> Building native libp533.so, libp372.so and ITURHFProp CLI"
(cd "${SRC_DIR}/Linux" && make all)

echo "==> Native build artifacts:"
ls -la "${SRC_DIR}/P533/Linux/libp533.so" \
       "${SRC_DIR}/P372/Linux/libp372.so" \
       "${SRC_DIR}/ITURHFProp/Linux/ITURHFProp"

echo "==> Done. Native CLI at: ${SRC_DIR}/ITURHFProp/Linux/ITURHFProp"
echo "    Data files at:       ${SRC_DIR}/P372/Data/"
echo "    Example inputs at:   ${SRC_DIR}/ITURHFProp/Bin/*.in"
