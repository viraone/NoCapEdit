# NoCap Edit YouTube helper: Node + ffmpeg + yt-dlp (nightly) + Deno, nothing else.
#   docker build -t nocap-youtube server/youtube
#   docker run -p 3131:3131 -e ALLOW_ORIGIN=https://nocapedit.com nocap-youtube
#
# Deno matters: yt-dlp needs a JavaScript runtime to solve YouTube's player
# challenges. Without one it falls back to the TV client, which YouTube answers
# with "The page needs to be reloaded" from server addresses. Nightly yt-dlp
# carries the YouTube fixes weeks before the stable release does.
FROM node:22-bookworm-slim

COPY --from=denoland/deno:bin-2.5.2 /deno /usr/local/bin/deno

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY lib.mjs server.mjs ./

ENV HOST=0.0.0.0 PORT=3131 MAX_MINUTES=180 MAX_JOBS=2
EXPOSE 3131
USER node
CMD ["node", "server.mjs"]
