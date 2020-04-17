#!/usr/bin/env bash

set -e

export TARGET_HOST=192.168.1.250
export TARGET_HOST_USER=dgreen

scp build/irrigatalizer.tgz "$TARGET_HOST_USER@$TARGET_HOST:/home/dgreen"

ssh "$TARGET_HOST_USER@$TARGET_HOST" "pm2 ls && pm2 stop irrigatalizer && rm -rf irrigatalizer && tar -xzf irrigatalizer.tgz && pm2 start irrigatalizer"