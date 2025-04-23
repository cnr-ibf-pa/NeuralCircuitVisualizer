#!/bin/bash

cd static/js
latest_release=$(curl -s https://api.github.com/repos/mrdoob/three.js/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
wget https://github.com/mrdoob/three.js/archive/$latest_release.zip
unzip $latest_release.zip
rm $latest_release.zip
mv three.js-$latest_release threejs