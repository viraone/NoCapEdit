"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Copy, RotateCcw, X, Plus } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject, useTargetClip } from "./shared";
import type { PostDraft } from "@/lib/models/project";
import { checkChromeAi, frameOf, generatePost, type AiStatus } from "@/lib/ai/chromeAi";
import { LENGTHS, PLATFORMS, TONES, cleanHashtag, hashtagCount, postAsText, type PostLength, type PostPlatform, type PostTone } from "@/lib/ai/postPrompt";
import { getAsset } from "@/lib/storage/db";
import { PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Input, textareaClass } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cx } from "@/lib/utils/cx";

const EMPTY: PostDraft = { title: "", caption: "", hashtags: [] };

type Source = "said" | "picture";

/** Title, caption and hashtags for the video, written by Chrome's built-in AI on the user's own computer. */
export function PostPanel() {
  const project = useProject();
  const clip = useTargetClip();
  const post = project.post ?? EMPTY;
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [source, setSource] = useState<Source>(project.cues.length ? "said" : "picture");
  const [tone, setTone] = useState<PostTone>("funny");
  const [length, setLength] = useState<PostLength>("short");
  const [platform, setPlatform] = useState<PostPlatform>("instagram");
  const [notes, setNotes] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    checkChromeAi().then((s) => alive && setAi(s));
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  const speech = project.cues.map((c) => c.text).join(" ");
  const onScreen = project.overlays.flatMap((o) => (o.kind === "text" ? [o.text] : [])).join(" ");
  const canReadPicture = !!ai?.image && !!clip;
  const material = source === "said" ? speech : onScreen;
  const hasMaterial = material.trim().length > 0 || (source === "picture" && canReadPicture) || notes.trim().length > 0;
  const ready = !!ai && ai.api !== null;

  const save = (fn: (p: PostDraft) => void) =>
    useEditor.getState().update(
      (p) => {
        const next = { ...EMPTY, ...p.post, hashtags: [...(p.post?.hashtags ?? [])] };
        fn(next);
        p.post = next;
      },
      { history: false },
    );

  const copy = (text: string, what: string) => {
    if (!text.trim()) return;
    navigator.clipboard?.writeText(text).then(
      () => useEditor.getState().setNotice(`Copied the ${what}.`),
      () => useEditor.getState().setNotice("Could not copy. Select the text and copy it yourself."),
    );
  };

  const write = async () => {
    if (!ai || !ai.api || busy) return;
    setError(null);
    setDownload(null);
    const controller = new AbortController();
    abort.current = controller;
    setBusy(ai.availability === "available" ? "Writing" : "Getting ready");
    try {
      let image: HTMLCanvasElement | null = null;
      if (source === "picture" && canReadPicture && clip) {
        const asset = await getAsset(clip.assetId);
        if (asset) image = await frameOf(asset.blob, clip.inPoint);
      }
      const draft = await generatePost(
        { source: material, notes, tone, length, platform },
        ai,
        {
          image,
          signal: controller.signal,
          onDownload: (f) => {
            setDownload(f);
            setBusy(f < 1 ? "Downloading" : "Writing");
          },
        },
      );
      if (!draft.caption && !draft.title && !draft.hashtags.length) throw new Error("The AI did not write anything. Try again.");
      save((p) => Object.assign(p, draft));
      checkChromeAi().then(setAi);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abort.current = null;
      setBusy(null);
      setDownload(null);
    }
  };

  const addTag = () => {
    const t = cleanHashtag(tag);
    setTag("");
    if (!t || post.hashtags.some((h) => h.toLowerCase() === t.toLowerCase())) return;
    save((p) => void p.hashtags.push(t));
  };

  const hasPost = !!(post.title || post.caption || post.hashtags.length);

  return (
    <>
      <PanelHeader title="Post" description="Write the title, caption and hashtags for sharing this video. The AI runs in your browser; nothing is sent anywhere." />
      <PanelSection title="Write it for me">
        {!ai && <p className="rf-read-note">Checking what this browser can do…</p>}
        {ai && !ready && (
          <div className="space-y-1.5" data-post-unsupported>
            <p className="rf-read-note">
              <b>This browser can&apos;t write captions for you.</b> Chrome on a desktop computer can, once its built-in AI is turned on. You can still write one yourself below.
            </p>
            <p className="rf-read-note">
              To try it: in Chrome open <b>chrome://flags</b>, turn on <b>Prompt API for Gemini Nano</b> and <b>Enables optimization guide on device</b> (choose <b>Enabled BypassPerfRequirement</b>), then restart Chrome.
            </p>
          </div>
        )}
        {ready && (
          <>
            <Field label="Based on">
              <Select value={source} onChange={(e) => setSource(e.target.value as Source)} disabled={!!busy}>
                <option value="said">What&apos;s said (captions){speech ? "" : " — none yet"}</option>
                <option value="picture">{ai.image ? "The picture and its text" : "Text you added on the video"}</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Tone">
                <Select value={tone} onChange={(e) => setTone(e.target.value as PostTone)} disabled={!!busy}>
                  {TONES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Length">
                <Select value={length} onChange={(e) => setLength(e.target.value as PostLength)} disabled={!!busy}>
                  {LENGTHS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="For">
              <Select value={platform} onChange={(e) => setPlatform(e.target.value as PostPlatform)} disabled={!!busy}>
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · {p.hashtags} hashtags
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mention (optional)" hint="A date, a place, a link in bio. The AI will not invent these for you.">
              <textarea className={cx(textareaClass, "min-h-12")} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fri Oct 30, 7–9 PM · sign up at the link in bio" disabled={!!busy} />
            </Field>
            <Button variant="primary" size="md" className="h-auto min-h-9 w-full whitespace-normal py-2 text-center" disabled={!!busy || !hasMaterial} onClick={() => void write()} data-post-write>
              {hasPost ? <RotateCcw size={14} /> : <Sparkles size={14} />}
              {busy ? `${busy}…` : hasPost ? "Write it again" : "Write my caption"}
            </Button>
            {busy && (
              <div className="space-y-1.5">
                <ProgressBar value={download !== null && download < 1 ? download : null} />
                {download !== null && download < 1 ? (
                  <p className="rf-read-note">
                    Downloading Chrome&apos;s built-in AI: {Math.round(download * 100)}%. One time only. You can keep editing while it downloads.
                  </p>
                ) : (
                  busy === "Getting ready" && <p className="rf-read-note">Getting Chrome&apos;s built-in AI ready…</p>
                )}
                <Button variant="ghost" size="xs" onClick={() => abort.current?.abort()}>
                  Cancel
                </Button>
              </div>
            )}
            {!busy && !hasMaterial && <p className="rf-read-note">{source === "said" ? "Add captions in Subtitles first, or type what to mention above." : "Add text on the video, or type what to mention above."}</p>}
            {ai.api === "writer" && <p className="rf-read-note">This Chrome can only write plain text, so it cannot read the picture.</p>}
            {error && <p className="rf-read-note rf-error whitespace-pre-wrap">{error}</p>}
          </>
        )}
      </PanelSection>

      <PanelSection title="Your post" right={hasPost ? <Button variant="ghost" size="xs" onClick={() => save((p) => Object.assign(p, EMPTY, { hashtags: [] }))}>Clear</Button> : undefined}>
        <Field label="Title" right={<CopyButton onClick={() => copy(post.title, "title")} disabled={!post.title} />}>
          <Input value={post.title} onChange={(e) => save((p) => void (p.title = e.target.value))} placeholder="A short title" data-post-title />
        </Field>
        <Field label="Caption" right={<CopyButton onClick={() => copy(post.caption, "caption")} disabled={!post.caption} />}>
          <textarea className={cx(textareaClass, "min-h-28")} value={post.caption} onChange={(e) => save((p) => void (p.caption = e.target.value))} placeholder="What you want to say with the video" data-post-caption />
        </Field>
        <Field label={`Hashtags (${post.hashtags.length})`} right={<CopyButton onClick={() => copy(post.hashtags.join(" "), "hashtags")} disabled={!post.hashtags.length} />}>
          <div className="space-y-2">
            {post.hashtags.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" data-post-hashtags>
                {post.hashtags.map((h) => (
                  <li key={h} className="flex items-center gap-1 rounded-full bg-sys-gray4 py-0.5 pl-2.5 pr-1 text-[12px] text-white">
                    {h}
                    <button type="button" className="flex h-4 w-4 items-center justify-center rounded-full text-white/60 hover:bg-sys-red hover:text-white" aria-label={`Remove ${h}`} onClick={() => save((p) => void (p.hashtags = p.hashtags.filter((x) => x !== h)))}>
                      <X size={10} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " " || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder={`Add a hashtag (${hashtagCount(platform)} suggested)`}
              />
              <Button variant="secondary" size="sm" className="shrink-0" onClick={addTag} disabled={!cleanHashtag(tag)} aria-label="Add hashtag">
                <Plus size={13} />
              </Button>
            </div>
          </div>
        </Field>
        <Button variant="secondary" size="md" className="w-full" disabled={!hasPost} onClick={() => copy(postAsText(post), "caption and hashtags")} data-post-copy-all>
          <Copy size={13} /> Copy caption and hashtags
        </Button>
      </PanelSection>
    </>
  );
}

function CopyButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick} disabled={disabled}>
      <Copy size={11} /> Copy
    </Button>
  );
}
