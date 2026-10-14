# YouTube helper

The start screen's "Paste a YouTube link" bar needs one thing the static site
cannot do in a browser: fetch the video from YouTube. This folder is that helper.
It runs yt-dlp and streams back a browser-playable MP4 (H.264 + AAC, up to the
height the visitor picked). The site then stores the file in the visitor's browser
like any dropped recording. The helper never sees the visitor's projects.

Zero npm dependencies. Needs Node 20+, `yt-dlp` and `ffmpeg` on the PATH.

## Run it on your own computer

```bash
brew install yt-dlp ffmpeg      # once
npm run youtube                 # listens on http://127.0.0.1:3131
```

Leave it running and open https://nocapedit.com (or `npm run dev`). The site looks
for the helper at `127.0.0.1:3131` by default, so links pasted on this computer work
right away, including on the live site. YouTube changes often; if downloads start
failing with an extraction or 403 error, run `brew upgrade yt-dlp`.

## Host it for visitors

Visitors do not have the helper on their machines, so for the bar to work for
everyone, run a copy somewhere public and build the site with its address:

```bash
NEXT_PUBLIC_YOUTUBE_SERVICE_URL=https://yt.example.com npm run build
```

(For GitHub Pages, add that variable to the `npm run build` step in
`.github/workflows/pages.yml`.) A `Dockerfile` is included:

```bash
docker build -t nocap-youtube server/youtube
docker run -p 3131:3131 -e ALLOW_ORIGIN=https://nocapedit.com nocap-youtube
```

Put it behind HTTPS (Caddy, a Fly.io or Railway app, a Cloudflare tunnel) because the
site is served over HTTPS and may only call HTTPS or `127.0.0.1`.

Be aware that YouTube often blocks downloads from data-centre addresses ("Sign in to
confirm you're not a bot"). A small VPS with a residential-looking address, or
`YTDLP_ARGS="--cookies /data/cookies.txt"` with an exported cookie file, usually gets
around it. Only download videos you have the right to use.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3131` | Listen port |
| `HOST` | `127.0.0.1` | Bind address; `0.0.0.0` inside a container |
| `ALLOW_ORIGIN` | `*` | `Access-Control-Allow-Origin`; set to the site's origin when hosted |
| `MAX_MINUTES` | `180` | Longest video accepted |
| `MAX_JOBS` | `2` | Downloads running at once (more get a 429) |
| `YTDLP` | `yt-dlp` | yt-dlp executable |
| `YTDLP_ARGS` | | Extra yt-dlp arguments, e.g. `--cookies /data/cookies.txt` |

## Routes

All `GET`, CORS enabled, JSON errors as `{ "error": "..." }`.

| Route | Returns |
| --- | --- |
| `/health` | `{ ok, ytdlp, maxMinutes }` |
| `/info?url=<link>` | `{ id, title, duration, thumbnail, uploader, heights, maxSeconds }` |
| `/download?url=<link>&height=1080` | `video/mp4` body with `Content-Length`, `X-Video-Title` (URL-encoded), `X-Video-Id`, `X-Video-Duration` |

Links are reduced to `https://www.youtube.com/watch?v=<id>` before yt-dlp sees them,
so playlists and tracking parameters are ignored. Live streams and videos longer than
`MAX_MINUTES` are refused. Closing the browser tab mid-download kills yt-dlp and
removes the temporary file.

## Pointing a built site at another helper without rebuilding

In the browser console on the start screen:

```js
localStorage.setItem("nocap.youtubeService", "https://yt.example.com");
```

Remove the key to go back to the built-in address.
