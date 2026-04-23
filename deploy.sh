#!/bin/bash
set -e

docker stop obf_storage && docker rm obf_storage
docker build --no-cache -t obf-storage:latest .
docker run -d \
  --name obf_storage \
  --restart unless-stopped \
  --network webnet \
  -v /mnt/storage/uploads:/mnt/storage/uploads \
  obf-storage:latest

echo "Done"