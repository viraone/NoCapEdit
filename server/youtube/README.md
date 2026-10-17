# YouTube / Instagram helper

The start screen's "Paste a YouTube or Instagram Reel link" bar needs one thing the
static site cannot do in a browser: fetch the video from YouTube or Instagram. This
folder is that helper. It runs yt-dlp and streams back a browser-playable MP4 (H.264 +
AAC; up to the height the visitor picked for YouTube, full size for a Reel), or just
the sound as an MP3. The site then stores the MP4 in the visitor's browser like any
dropped recording, or saves the MP3 to their computer. The helper never sees the
visitor's projects.

Zero npm dependencies. Needs Node 20+, `yt-dlp`, `ffmpeg` and `deno` on the PATH
(yt-dlp uses Deno to solve YouTube's player challenges; without it YouTube answers
"The page needs to be reloaded" from server addresses).

## Run it on your own computer

```bash
brew install yt-dlp ffmpeg deno # once
npm run youtube                 # listens on http://127.0.0.1:3131
```

Leave it running and open https://nocapedit.com (or `npm run dev`). The site looks
for the helper at `127.0.0.1:3131` by default, so links pasted on this computer work
right away, including on the live site. YouTube changes often; if downloads start
failing with an extraction or 403 error, run `brew upgrade yt-dlp`.

## Host it for visitors (one-time setup)

Visitors do not have the helper on their machines, so for the bar to work for
everyone a copy has to run on a public server. The repo's `render.yaml` makes that one
click on Render's free tier (no card needed):

1. Open https://render.com/deploy?repo=https://github.com/viraone/NoCapEdit and sign in
   with GitHub. Render reads `render.yaml`, builds `server/youtube/Dockerfile` and gives
   the service an address like `https://nocap-youtube.onrender.com`.
2. Tell the site about it. In the GitHub repo: Settings → Secrets and variables →
   Actions → Variables → New repository variable, name `YOUTUBE_SERVICE_URL`, value the
   address from step 1. Or from a terminal:
   ```bash
   gh variable set YOUTUBE_SERVICE_URL --body https://nocap-youtube.onrender.com
   gh workflow run pages.yml
   ```
3. The Pages deploy bakes the address into the site (`NEXT_PUBLIC_YOUTUBE_SERVICE_URL`).
   From then on every visitor's pasted link goes through the hosted helper.

Free-tier notes: the service sleeps after 15 idle minutes and takes up to a minute to
wake (the card says so while it waits); 0.1 CPU makes 1080p merges of long videos slow.
Render's Starter plan removes both. Fly.io works too (`server/youtube/fly.toml`,
`cd server/youtube && fly launch --copy-config --yes`), as does any host that runs a
Docker image:

```bash
docker build -t nocap-youtube server/youtube
docker run -p 3131:3131 -e ALLOW_ORIGIN=https://nocapedit.com nocap-youtube
```

It must be reachable over HTTPS, because the site is served over HTTPS and may only
call HTTPS or `127.0.0.1`.

### If downloads fail with "Sign in to confirm you're not a bot"

YouTube often blocks data-centre addresses. Export cookies from a browser signed in to
a throwaway YouTube account (the "Get cookies.txt LOCALLY" extension, Netscape format)
and put the file in the service's `YTDLP_COOKIES` environment variable. Base64 keeps it
on one line, which any settings box accepts:

```bash
base64 -i ~/Downloads/www.youtube.com_cookies.txt | tr -d '\n' | pbcopy   # then paste as the value
```

The helper decodes it, writes a temp file and passes `--cookies`. Cookies expire after
some weeks; export again if the bot check comes back. Only download videos you have the
right to use.

### If Instagram reels fail with "Instagram wouldn't hand over this reel"

Instagram usually refuses to serve a reel to anything that isn't a signed-in browser,
even when the reel is public, and says so with "empty media response" or "login
required". The fix is the same cookies setting: sign the browser in to a throwaway
Instagram account as well, export cookies.txt from `instagram.com` and put the file in
`YTDLP_COOKIES`. One Netscape cookies file can hold both sites' cookies, so export once
from a browser signed in to both and the helper covers YouTube and Instagram together.
Instagram also rate-limits busy addresses; if reels start failing after a run of
downloads, wait a while or rotate to a fresh throwaway account.

Links that start with `instagram.com/share/` are opaque share tokens, not reel
addresses; the bar refuses them. Open the link once in a browser and copy the
`instagram.com/reel/…` address it lands on.

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
| `/info?url=<link>` | `{ id, source, title, duration, thumbnail, uploader, heights, maxSeconds }` (`source` is `youtube` or `instagram`) |
| `/download?url=<link>&height=1080` | `video/mp4` body with `Content-Length`, `X-Video-Title` (URL-encoded), `X-Video-Id`, `X-Video-Duration`; `height` applies to YouTube only |
| `/download?url=<link>&format=mp3` | `audio/mpeg` body (best audio track converted by ffmpeg, highest VBR quality), same headers |

`<link>` is a YouTube video link or an Instagram reel/post link (`/reel/`, `/reels/`,
`/p/`, `/tv/`). Links are reduced to `https://www.youtube.com/watch?v=<id>` or
`https://www.instagram.com/reel/<shortcode>/` before yt-dlp sees them, so playlists and
tracking parameters are ignored. Live streams and videos longer than `MAX_MINUTES` are
refused. Closing the browser tab mid-download kills yt-dlp and removes the temporary
file.

## Pointing a built site at another helper without rebuilding

In the browser console on the start screen:

```js
localStorage.setItem("nocap.youtubeService", "https://yt.example.com");
```

Remove the key to go back to the built-in address.
