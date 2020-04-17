#!/usr/bin/env bash

set -e

mkdir -p build
npm run build
rsync -a --exclude-from=package-excludes.txt . build/irrigatalizer

cd build/irrigatalizer
npm install --production
cd ../..

tar -C build -czf build/irrigatalizer.tgz irrigatalizer

ls -al build/irrigatalizer.tgz
