#!/usr/bin/env bash

set -e

export TARGET_HOST=pi2
export TARGET_HOST_USER=dgreen

scp build/irrigatalizer.tgz "$TARGET_HOST_USER@$TARGET_HOST:/home/$TARGET_HOST_USER"

ssh "$TARGET_HOST_USER@$TARGET_HOST" "pm2 ls && pm2 stop irrigatalizer && rm -rf irrigatalizer && tar -xzf irrigatalizer.tgz && cd irrigatalizer && echo 'installing dependencies...' && npm install --omit=dev && cd .. && pm2 start irrigatalizer"