#!/bin/zsh

INKSCAPE="/Applications/Inkscape.app/Contents/MacOS/inkscape"

basepath=`dirname $0:A`

function makeTransparentPng() {
    source=$1
    width=${2:r}
    target=$3
    mkdir -p `dirname $target`
    $INKSCAPE --export-width=${width} --export-background-opacity=0 --export-type=png --export-filename="$target" "$source" > /dev/null
}

function makeOpaquePng() {
    source=$1
    width=${2:r}
    target=$3
    mkdir -p `dirname $target`
    $INKSCAPE --export-width=${width} --export-background-opacity=1 --export-type=png --export-filename="$target" "$source" > /dev/null
}

function makeImage() {
    imageSourceFile=$1
    imageBaseSize=$2
    imageTargetFolder=$3
    imageBareFilename=${imageSourceFile:t:r}
    
    echo "  creating image from $sourceFile at ${baseSize}px"

    makeTransparentPng $imageSourceFile $imageBaseSize "$imageTargetFolder/${imageBareFilename}_$imageBaseSize.png"
    makeTransparentPng $imageSourceFile $(echo "(($imageBaseSize*1.5)+0.5)/1" | bc) "$imageTargetFolder/1.5x/${imageBareFilename}_$imageBaseSize.png"
    makeTransparentPng $imageSourceFile $(($imageBaseSize*2)) "$imageTargetFolder/2.0x/${imageBareFilename}_$imageBaseSize.png"
    makeTransparentPng $imageSourceFile $(($imageBaseSize*3)) "$imageTargetFolder/3.0x/${imageBareFilename}_$imageBaseSize.png"
}

function makeImagesInFolder() {
    folder=$1
    outputFolder=$2
    baseSize=$3

    sourceFolder=$basepath/artwork/$folder
    targetFolder=$basepath/$outputFolder

    echo "creating images assets from sources in $folder"

    mkdir -p $targetFolder
    for sourceFile in $sourceFolder/*.svg; do makeImage $sourceFile $baseSize $targetFolder; done;

    echo 'done creating image assets'
}


makeTransparentPng artwork/images/irrigatalizer-logo.svg 192 web/icons/Icon-192.png 
makeOpaquePng artwork/images/irrigatalizer-logo.svg 192 web/icons/Icon-maskable-192.png
makeTransparentPng artwork/images/irrigatalizer-logo.svg 512 web/icons/Icon-512.png 
makeOpaquePng artwork/images/irrigatalizer-logo.svg 512 web/icons/Icon-maskable-512.png
makeTransparentPng artwork/images/irrigatalizer-logo.svg 512 web/favicon.png 

makeImagesInFolder icons icons 24
