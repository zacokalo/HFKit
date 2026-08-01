#!/usr/bin/env bash
# Builds ITURHFProp/P533/P372 to a single WebAssembly module with Emscripten.
#
# Unlike the native build (which dlopen()s libp533.so/libp372.so at runtime),
# this build statically links P533 + P372 + ITURHFProp into ONE wasm module.
# wasm has no meaningful dlopen()-of-a-shared-library story for a
# browser-deployed static site, so patches/emscripten-static-link.patch
# replaces the three dlopen()/dlsym() call sites with direct C function
# pointer assignments, guarded by `#elif __EMSCRIPTEN__` branches that sit
# alongside the existing `#ifdef _WIN32` / `#elif __linux__ || __APPLE__`
# branches already in the upstream source. No algorithm code (P533.c's
# actual math, ReadIonParameters.c, CircuitReliability.c, etc.) is touched --
# only the DLL-loading glue. See patches/emscripten-static-link.patch for the
# full diff and FINDINGS.md for why this was necessary.
#
# Prerequisites: emsdk activated (emcc on PATH). If you don't have it:
#   git clone https://github.com/emscripten-core/emsdk.git
#   cd emsdk && ./emsdk install latest && ./emsdk activate latest
#   source ./emsdk_env.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build-wasm"
SRC_DIR="${BUILD_DIR}/ITU-R-HF"
REPO_URL="https://github.com/ITU-R-Study-Group-3/ITU-R-HF.git"
PATCH_FILE="${SCRIPT_DIR}/patches/emscripten-static-link.patch"
OUT_DIR="${BUILD_DIR}/out"

if ! command -v emcc >/dev/null 2>&1; then
  echo "ERROR: emcc not found on PATH. Activate an Emscripten SDK first (see" >&2
  echo "       the comment at the top of this script)." >&2
  exit 1
fi

mkdir -p "${BUILD_DIR}"

if [ ! -d "${SRC_DIR}" ]; then
  echo "==> Cloning ${REPO_URL}"
  git clone --depth 1 "${REPO_URL}" "${SRC_DIR}"
  rm -rf "${SRC_DIR}/.git"

  echo "==> Applying ${PATCH_FILE}"
  (cd "${SRC_DIR}" && patch -p1 < "${PATCH_FILE}")
else
  echo "==> Source already present at ${SRC_DIR}, skipping clone + patch"
  echo "    (delete ${SRC_DIR} to force a clean re-clone)"
fi

mkdir -p "${OUT_DIR}"

P533_SRCS="Between7000kmand9000km ELayerScreeningFrequency Magfit MedianSkywaveFieldStrengthShort ReadIonParameters CalculateCPParameters Geometry MUFBasic P533 MUFOperational ReadP1239 CircuitReliability InitializePath MedianAvailableReceiverPower ReadType13 InputDump MedianSkywaveFieldStrengthLong MUFVariability PathMemory ValidatePath"
P372_SRCS="InitializeNoise Noise NoiseMemory"
ITURHFPROP_SRCS="DumpPathData ITURHFProp ReadInputConfiguration Report ValidateITURHFP"

SRC_FILES=()
for f in $P533_SRCS; do SRC_FILES+=("P533/Src/P533/${f}.c"); done
for f in $P372_SRCS; do SRC_FILES+=("P372/Src/P372/${f}.c"); done
for f in $ITURHFPROP_SRCS; do SRC_FILES+=("ITURHFProp/Src/ITURHFProp/${f}.c"); done

echo "==> Compiling ${#SRC_FILES[@]} source files to wasm"
(
  cd "${SRC_DIR}"
  emcc -std=c99 -O2 \
    "${SRC_FILES[@]}" \
    -lm \
    -Wl,--allow-multiple-definition \
    -sALLOW_MEMORY_GROWTH=1 \
    -sSTACK_SIZE=8388608 \
    -sEXIT_RUNTIME=1 \
    -sENVIRONMENT=node \
    -sMODULARIZE=1 \
    -sINVOKE_RUN=0 \
    -sFORCE_FILESYSTEM=1 \
    -sEXPORTED_RUNTIME_METHODS=callMain,FS \
    -o "${OUT_DIR}/iturhfprop.js"
)

echo "==> Build artifacts:"
ls -la "${OUT_DIR}/iturhfprop.wasm" "${OUT_DIR}/iturhfprop.js"

echo "==> Copying node harness (run.js) into ${OUT_DIR}"
cp "${SCRIPT_DIR}/run.js" "${OUT_DIR}/run.js"

echo "==> Done. Verify with e.g.:"
echo "    node ${OUT_DIR}/run.js ${SRC_DIR}/ITURHFProp/Bin/1-5-85.in /tmp/wasm_1-5-85.out"
