#!/bin/bash
set -e

BUILD_TYPE=Release
RUN_AFTER_BUILD=0

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

mkdir -p build
cd build
cmake -DCMAKE_BUILD_TYPE=$BUILD_TYPE ..
cmake --build . --parallel

if [[ $RUN_AFTER_BUILD -eq 1 ]]; then
    ./server
fi

# Usage:
# ./build.sh --release :       builds in Release mode
# ./build.sh --debug :         builds in Debug mode
# ./build.sh --release --run : builds in Release mode and runs
# ./build.sh --debug --run :   builds in Debug mode and runs
