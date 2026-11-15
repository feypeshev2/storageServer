#!/bin/bash
set -e

# the API's JWT secret, so storage can verify the same tokens (only this one value, not the API's other secrets)
JWT_SECRET="$(grep -E '^JWT_SECRET=' ~/prod/.env.prod | cut -d= -f2-)"
[ -n "$JWT_SECRET" ] || { echo "JWT_SECRET not found in ~/prod/.env.prod"; exit 1; }

docker stop obf_storage_prod && docker rm obf_storage_prod
docker build --no-cache -t obf-storage:latest .
docker run -d \
  --name obf_storage_prod \
  --restart unless-stopped \
  --network obf-prod-net \
  -e JWT_SECRET="$JWT_SECRET" \
  -e ALLOWED_ORIGINS=https://app.openbuzludzha.bg \
  -e PORT=3001 \
  -v /mntprod/storage/uploads:/mnt/storage/uploads \
  obf-storage:latest

docker exec reverse_proxy nginx -s reload
echo "Prod storage deployed"
