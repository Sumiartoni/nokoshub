#!/bin/sh
set -eu

echo "== Docker disk usage: before =="
docker system df || true

echo
echo "== Prune builder cache =="
docker builder prune -af || true

echo
echo "== Prune dangling and unused images =="
docker image prune -af || true

echo
echo "== Prune stopped containers =="
docker container prune -f || true

echo
echo "== Prune unused networks =="
docker network prune -f || true

if [ -d /var/lib/docker/containers ]; then
  echo
  echo "== Truncate oversized Docker json logs =="
  find /var/lib/docker/containers -name '*-json.log' -size +50M -exec sh -c ': > "$1"' _ {} \; || true
fi

echo
echo "== Docker disk usage: after =="
docker system df || true
