#!/bin/bash
set -e

# the API's JWT secret, so storage can verify the same tokens (only this one value, not the API's other secrets)
JWT_SECRET="$(grep -E '^JWT_SECRET=' ../APIServer/.env | cut -d= -f2-)"
[ -n "$JWT_SECRET" ] || { echo "JWT_SECRET not found in ../APIServer/.env"; exit 1; }

docker stop obf_storage && docker rm obf_storage
docker build --no-cache -t obf-storage:latest .
docker run -d \
  --name obf_storage \
  --restart unless-stopped \
  --network webnet \
  -e JWT_SECRET="$JWT_SECRET" \
  -v /mnt/storage/uploads:/mnt/storage/uploads \
  obf-storage:latest

docker exec reverse_proxy nginx -s reload
echo "Dev storage deployed"
