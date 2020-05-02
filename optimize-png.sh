#!/usr/bin/env bash

set -e

filename="$1"

if [ "$filename" = "" ]; then
    echo "Must provide a filename"
    exit -1
fi

pngquant --strip --speed 1 "$filename"; 
zopflipng -m "${filename/\.png/-fs8.png}" "${filename/\.png/-zop.png}"; 
rm "${filename/\.png/-fs8.png}";
mv "${filename/\.png/-zop.png}" "$filename"; 