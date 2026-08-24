#!/bin/bash
set -euo pipefail

BUILD_TYPE=Release
RUN_AFTER_BUILD=0
RUN_TESTS=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_ROOT="${CPP_SERVER_BUILD_ROOT:-${SCRIPT_DIR}/.build/3d}"

for arg in "$@"; do
    case $arg in
        --debug)
            BUILD_TYPE=Debug
            ;;
        --release)
            BUILD_TYPE=Release
            ;;
        --run)
            RUN_AFTER_BUILD=1
            ;;
        --test)
            RUN_TESTS=1
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Usage: $0 [--debug|--release] [--test] [--run]"
            exit 1
            ;;
    esac
done

# Check prerequisites
if [[ -z "${VCPKG_ROOT:-}" ]]; then
    echo "ERROR: VCPKG_ROOT is not set"
    echo "Set it to a vcpkg checkout before building the server."
    exit 1
fi

VCPKG_TOOLCHAIN="${VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"

if [[ ! -f "$VCPKG_TOOLCHAIN" ]]; then
    echo "ERROR: vcpkg toolchain not found!"
    echo "Expected: $VCPKG_TOOLCHAIN"
    echo "Is vcpkg installed in $VCPKG_ROOT ?"
    exit 1
fi

if ! command -v cmake >/dev/null; then
    echo "ERROR: cmake not installed"
    exit 1
fi

# Build in a fresh 3D-specific tree. The legacy server/build cache is not used.
BUILD_FLAVOR="$(printf '%s' "$BUILD_TYPE" | tr '[:upper:]' '[:lower:]')"
BUILD_DIR="${BUILD_ROOT}/${BUILD_FLAVOR}"
mkdir -p "$BUILD_DIR"

cmake -S "$SCRIPT_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DCMAKE_TOOLCHAIN_FILE="$VCPKG_TOOLCHAIN"

cmake --build "$BUILD_DIR" --parallel

if [[ $RUN_TESTS -eq 1 ]]; then
    ctest --test-dir "$BUILD_DIR" --output-on-failure
fi

# Run
if [[ $RUN_AFTER_BUILD -eq 1 ]]; then
    # Load .env if present (dev convenience)
    if [[ -f "${SCRIPT_DIR}/.env" ]]; then
        echo "[Dev] Loading environment from .env"
        set -o allexport
        source "${SCRIPT_DIR}/.env"
        set +o allexport
    fi

    cd "$SCRIPT_DIR"
    "$BUILD_DIR/server"
fi
