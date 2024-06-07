#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

function run_test_in_directory() {
    : "${1:? Directory should be the first parameter}"
    local test_dir="${1}"
    pushd "${test_dir}" || exit 1
    npm install --quiet
    if ! node index.js; then
        echo "Test failed for directory: ${test_dir}"
        exit 2
    else
        echo "Test passed for directory: ${test_dir}"
    fi
    
}

function main() {
    run_test_in_directory "${SCRIPT_DIR}/commonjs"
    run_test_in_directory "${SCRIPT_DIR}/esmodule"
    run_test_in_directory "${SCRIPT_DIR}/typescript"
}

main