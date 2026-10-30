#!/bin/sh
# Container entrypoint: the PO-token server (loopback only, where the yt-dlp plugin looks
# for it by default) in the background, then the helper in the foreground. If the token
# server ever dies the helper keeps running; YouTube then just gets no token.
node /opt/bgutil/build/main.js --host 127.0.0.1 --port 4416 &
exec node server.mjs
