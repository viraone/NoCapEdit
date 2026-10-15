import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withBase } from "@/lib/basePath";

export const metadata: Metadata = {
  title: "NoCap Edit · How to",
  description: "How to turn a YouTube link or a recording into captioned reels with NoCap Edit, and how to get the free Google key the Reels panel uses.",
};

/** A step list with a screenshot under it; the docs are plain HTML so they ship static like the rest of the site. */
function Shot({ src, alt, width, height, className }: { src: string; alt: string; width: number; height: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={withBase(`/docs/${src}`)} alt={alt} width={width} height={height} loading="lazy" className={`mt-5 w-full rounded-2xl border border-sys-gray4 bg-sys-gray6 ${className ?? ""}`} />
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-6 rounded-3xl p-7">
      <h2 className="text-2xl font-semibold tracking-tight">
        <a href={`#${id}`} className="hover:text-sys-blue">
          {title}
        </a>
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-label-2">{children}</div>
    </section>
  );
}

const steps = "list-decimal space-y-2 pl-6 marker:text-label-3";

export default function DocsPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10 text-[15px] sm:px-8">
      <header>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-label-2 hover:text-white">
          <ArrowLeft size={16} /> Projects
        </Link>
        <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight">How to use NoCap Edit</h1>
        <p className="mt-3 text-lg text-label-2">From a YouTube link or a recording to captioned vertical reels, in your browser. Nothing is installed and your videos never leave your device.</p>
        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-sm">
          {[
            ["#start", "1. Start a project"],
            ["#edit", "2. Open and edit"],
            ["#reels", "3. Reels"],
            ["#api-key", "4. Free Google key"],
            ["#cost", "5. What it costs"],
            ["#export", "6. Export"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full border border-sys-gray4 bg-sys-gray5 px-3 py-1 text-label-2 hover:border-sys-gray2 hover:text-white">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <main className="mt-10 space-y-6">
        <Section id="start" title="1. Start a project">
          <p>There are two ways in, both on the start page.</p>
          <ol className={steps}>
            <li>
              <b className="text-white">Paste a YouTube link.</b> Copy the video&apos;s address from YouTube, paste it into the bar at the top, pick a quality (1080p is the default), and click <b className="text-white">Convert</b>. A card appears under <b className="text-white">Your projects</b> while the video downloads, then becomes a project with the video&apos;s title. The first paste after a quiet spell can take about a minute while the helper wakes up.
            </li>
            <li>
              <b className="text-white">Drop a file.</b> Drag an MP4, MOV or WebM onto the big box, or click it to choose one. An image works too and becomes a 12-second Instagram post.
            </li>
          </ol>
          <Shot src="start-paste-link.png" alt="The paste bar on the start page: a YouTube link, the 1080p quality picker and the Convert button" width={1200} height={300} />
          <p className="text-sm text-label-3">Only download videos you have the right to use: your own, or for private editing practice.</p>
        </Section>

        <Section id="edit" title="2. Open and edit">
          <p>Click the project&apos;s card (the picture or the title) to open the editor. The tools run down the left side: Clips, Trim, Subtitles, Style, Text, Picture, Music, Reels, Export. Everything autosaves to this browser, so you can close the tab and come back later.</p>
          <Shot src="project-card.png" alt="A project card under Your projects, showing the thumbnail, length, name and clip count" width={1200} height={700} />
          <p>
            A good order for a long landscape video: <b className="text-white">Reels</b> to cut out the best moments, then <b className="text-white">Subtitles</b> and <b className="text-white">Style</b> on each reel, then <b className="text-white">Export</b>.
          </p>
        </Section>

        <Section id="reels" title="3. Reels: let the AI pick the best moments">
          <p>
            The Reels panel reads the transcript of your video, picks the moments that stand on their own, and cuts each one into its own 9:16 reel with captions. Each reel becomes a separate project under Your projects.
          </p>
          <ol className={steps}>
            <li>Click the <b className="text-white">Reels</b> tool (the pink clapperboard).</li>
            <li>
              The first time, the panel asks how the model should run. Click <b className="text-white">Use my own key</b>. (The other choice, Ollama, runs a model on your own computer: free and private, but slower and it needs installing.)
            </li>
            <li>
              Under <b className="text-white">Provider</b> choose <b className="text-white">Google (Gemini)</b>.
            </li>
            <li>
              Paste your Google AI Studio key into the key box (how to get one is the next section) and click <b className="text-white">Save</b>. Saving checks the key and lists the models it can use.
            </li>
            <li>
              In <b className="text-white">Model</b> pick the newest Flash model, for example <code className="rounded bg-sys-gray5 px-1.5 py-0.5 text-[13px] text-white">gemini-3.8-flash</code>. Flash is fast, cheap and good at judging which bits work alone. The Pro models are slower and not better at this.
            </li>
            <li>
              Click <b className="text-white">Make reels</b>. If the video has no captions yet, the panel offers to generate them first (Whisper runs on your device; the first run downloads the model and takes a few minutes).
            </li>
            <li>Each reel shows up in the list with a score out of 10 and a title. Open one, tweak it, export it.</li>
          </ol>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-label-3">First visit: pick how the model runs.</p>
              <Shot src="reels-choose.png" alt="The Reels panel's first-time choice: Ollama on this computer, or your own API key" width={700} height={1000} />
            </div>
            <div>
              <p className="text-sm text-label-3">Then: provider, model, key, Make reels.</p>
              <Shot src="reels-panel.png" alt="The Reels panel with Google (Gemini) chosen as the provider, the model box, the API key box and the Make reels button" width={700} height={1000} />
            </div>
          </div>
          <p>Your key stays in this browser. Only the transcript, not the video, is sent to Google. If the picks look off, run Make reels again; each run can differ a little.</p>
        </Section>

        <Section id="api-key" title="4. Get a free Google AI Studio key">
          <p>Google AI Studio hands out API keys for Gemini with a free tier that is enough for this. It takes about a minute.</p>
          <ol className={steps}>
            <li>
              Go to{" "}
              <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer" className="text-sys-blue hover:underline">
                aistudio.google.com/api-keys
              </a>{" "}
              and sign in with any Google account.
            </li>
            <li>
              Click <b className="text-white">Create API key</b> at the top right. If it asks for a project, accept the default one it offers.
            </li>
            <li>Copy the key it shows (a long string of letters and numbers). You can come back to this page any time to copy it again.</li>
            <li>
              Back in NoCap Edit, paste it into the Reels panel&apos;s key box and click <b className="text-white">Save</b>.
            </li>
          </ol>
          <Shot src="aistudio-create-key.png" alt="The API Keys page in Google AI Studio with the Create API key button at the top right" width={1200} height={61} />
          <p>
            The key&apos;s row on that page says <b className="text-white">Free tier</b>. Leave it like that. You don&apos;t need to click &ldquo;Set up billing&rdquo; for this.
          </p>
          <Shot src="aistudio-model.png" alt="Google AI Studio describing Gemini 3.8 Flash, its most capable Flash model" width={700} height={360} className="max-w-sm" />
          <p className="text-sm text-label-3">The model names in AI Studio match what the Reels panel lists after you click Save, so pick the newest Flash you see there.</p>
        </Section>

        <Section id="cost" title="5. What it costs">
          <ul className="list-disc space-y-2 pl-6 marker:text-label-3">
            <li>
              <b className="text-white">NoCap Edit: free.</b> No account, no plan. Captions, editing and export run on your own computer.
            </li>
            <li>
              <b className="text-white">The Google key: free tier, $0.</b> Picking reels sends a few thousand words of transcript per run, which is tiny. On the free tier Google limits how many requests you can make per minute; if Make reels says you hit a limit, wait a minute and try again.
            </li>
            <li>
              <b className="text-white">You do not need any Google subscription.</b> Google One storage plans (the $2.99 a month kind) and Gemini app plans are separate products and don&apos;t affect the API key either way.
            </li>
            <li>
              <b className="text-white">Prefer nothing leaving your computer?</b> Choose <b className="text-white">Ollama on this computer</b> as the provider instead. It&apos;s slower and needs Ollama installed, but no key and no cloud.
            </li>
          </ul>
        </Section>

        <Section id="export" title="6. Export">
          <p>
            Open the <b className="text-white">Export</b> tool, keep the defaults (1080p, 30 fps, H.264) unless the platform asks for something else, and click <b className="text-white">Export video</b>. The MP4 lands in your Downloads folder, ready to post to Reels, TikTok or Shorts. Long videos render in segments, so memory stays flat even for a 20-minute source.
          </p>
          <p className="text-sm text-label-3">
            Something not working? The start page lists what your browser supports. Chrome or Edge on a laptop gives the fastest captions (WebGPU) and exports (multi-threaded).
          </p>
        </Section>
      </main>

      <footer className="mt-auto pt-14 text-sm text-label-3">
        Projects, clips and keys are stored in this browser only. Clearing site data removes them.
      </footer>
    </div>
  );
}
