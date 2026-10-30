# NoCap Edit YouTube helper: Node + ffmpeg + yt-dlp (nightly) + Deno, nothing else.
#   docker build -t nocap-youtube server/youtube
#   docker run -p 3131:3131 -e ALLOW_ORIGIN=https://nocapedit.com nocap-youtube
#
# Deno matters: yt-dlp needs a JavaScript runtime to solve YouTube's player
# challenges. Without one it falls back to the TV client, which YouTube answers
# with "The page needs to be reloaded" from server addresses. Nightly yt-dlp
# carries the YouTube fixes weeks before the stable release does.
#
# yt-dlp lives in /app/bin, owned by `node`, because the service refreshes it at
# start-up (update.mjs): this image only rebuilds when something under
# server/youtube/ changes, and YouTube moves faster than that. It is the nightly's
# Unix zipapp, which runs on the python3 installed below (Debian bookworm's 3.11).
FROM node:22-bookworm-slim

COPY --from=denoland/deno:bin-2.5.2 /deno /usr/local/bin/deno

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 \
 && mkdir -p /app/bin \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp -o /app/bin/yt-dlp \
 && chmod a+rx /app/bin/yt-dlp \
 && chown -R node:node /app/bin \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY lib.mjs update.mjs server.mjs ./

ENV HOST=0.0.0.0 PORT=3131 MAX_MINUTES=180 MAX_JOBS=2 YTDLP=/app/bin/yt-dlp YTDLP_SELF_UPDATE=1
EXPOSE 3131
USER node
CMD ["node", "server.mjs"]
