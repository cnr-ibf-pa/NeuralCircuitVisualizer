#!/bin/bash

if [ "$(uname)" == "Darwin" ]; then
    PLATFORM="mac"
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    PLATFORM="linux"
fi

cd static/js

# Check if unzip is installed
if ! command -v unzip &> /dev/null; then
    if [ "$PLATFORM" == "linux" ]; then
        echo "unzip could not be found, installing..."
        sudo apt-get update
        sudo apt-get install -y unzip
    elif [ "$PLATFORM" == "mac" ]; then
        echo "unzip could not be found, installing..."
        brew install unzip
    fi
fi

latest_release=$(curl -s https://api.github.com/repos/mrdoob/three.js/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
archive_name="$latest_release.zip"

# Check if the file already exists
if [ -f "$archive_name" ]; then
    echo "File $archive_name already exists. Exiting."
    exit 1
fi

if [ "$PLATFORM" == "linux" ]; then
    wget https://github.com/mrdoob/three.js/archive/$archive_name
elif [ "$PLATFORM" == "mac" ]; then
    curl -L https://github.com/mrdoob/three.js/archive/$archive_name > $archive_name
fi

unzip $archive_name
rm $archive_name
mv three.js-$latest_release threejs

cd -
