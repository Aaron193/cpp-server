#!/bin/bash
set -e

BUILD_TYPE=Release
RUN_AFTER_BUILD=0

VCPKG_ROOT="$HOME/vcpkg"
VCPKG_TOOLCHAIN="$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake"

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
        *)
            echo "Unknown option: $arg"
            echo "Usage: $0 [--debug|--release] [--run]"
            exit 1
            ;;
    esac
done

# Check prerequisites
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

# Build
mkdir -p build
cd build

cmake \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DCMAKE_TOOLCHAIN_FILE="$VCPKG_TOOLCHAIN" \
    ..

cmake --build . --parallel

# Run 
if [[ $RUN_AFTER_BUILD -eq 1 ]]; then
    # Load .env if present (dev convenience)
    if [[ -f "./.env" ]]; then
        echo "[Dev] Loading environment from .env"
        set -o allexport
        source ./.env
        set +o allexport
    elif [[ -f "../.env" ]]; then
        echo "[Dev] Loading environment from ../.env"
        set -o allexport
        source ../.env
        set +o allexport
    fi

    ./server
fi
