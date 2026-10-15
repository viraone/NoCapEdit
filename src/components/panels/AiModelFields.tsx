"use client";
/**
 * Provider and model picker for the transcript-reading AI, shared by the Reels
 * and Subtitles panels. Ollama on this computer is the default and keeps
 * everything local; an OpenAI-compatible API is opt-in for people who bring
 * their own key, and is told plainly that the transcript leaves the device.
 */
import { useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/basePath";
import { Check, RefreshCw, ShieldCheck } from "lucide-react";
import { DEFAULT_AI_SETTINGS, listAnthropicModels, listGeminiModels, listOllamaModels, listOpenAiModels, listXaiModels, type AiProvider, type AiSettings } from "@/lib/edit/aiHighlights";
import { Field, Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";

export interface AiModelFieldsProps {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  disabled?: boolean;
  /** Extra advice appended to Ollama errors on a public site (Chrome's local-network permission). */
  permissionHint?: string;
  /** Models found by the parent's own refresh (Ollama), if it keeps one. */
  models?: string[] | null;
  modelsError?: string | null;
  modelsPending?: boolean;
  onRefresh?: () => void;
}

/** Reusable fetch of a cloud provider's model list, with the same shape as the Ollama one. */
export function useCloudModels() {
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** True for a moment after the key checked out and the models loaded: the Save link turns into an animated "Saved". */
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (savedTimer.current && clearTimeout(savedTimer.current)), []);
  const refresh = async (load: () => Promise<string[]>, apiKey: string) => {
    setError(null);
    setJustSaved(false);
    if (!apiKey) {
      setModels(null);
      setError("Add your API key first.");
      return;
    }
    setPending(true);
    try {
      setModels(await load());
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_MS);
    } catch (e) {
      setModels(null);
      setError(e instanceof Error ? e.message : "Couldn't list models.");
    } finally {
      setPending(false);
    }
  };
  return { models, error, pending, justSaved, refresh };
}

/** How long the "Saved" state shows before the link reads "refresh" again. */
export const SAVED_MS = 2600;

/**
 * The link to the right of the Model label. Reads "Save" once a key is typed
 * (checking the key and loading its models), "Checking…" with a spinner while
 * that runs, then an animated green "Saved · N models" for a moment.
 */
function SaveLink({ title, onClick, apiKey, pending, justSaved, count, disabled }: { title: string; onClick: () => void; apiKey?: string; pending?: boolean; justSaved?: boolean; count?: number; disabled?: boolean }) {
  const save = !!apiKey?.trim();
  if (justSaved) {
    return (
      <span className="rf-saved inline-flex items-center gap-1 font-semibold text-sys-green" role="status" aria-live="polite" data-ai-saved>
        <Check size={12} className="rf-saved-check" strokeWidth={3} /> Saved{count ? ` · ${count} model${count === 1 ? "" : "s"}` : ""}
      </span>
    );
  }
  return (
    <button type="button" className="inline-flex items-center gap-1 text-sys-blue hover:underline disabled:opacity-60" onClick={onClick} title={title} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? <RefreshCw size={11} className="animate-spin" /> : save ? <Check size={11} /> : <RefreshCw size={11} />}
      {pending ? "Checking…" : save ? "Save" : "refresh"}
    </button>
  );
}

function ModelPicker({ value, models, onChange, placeholder, disabled }: { value: string; models: string[] | null | undefined; onChange: (m: string) => void; placeholder: string; disabled?: boolean }) {
  return models && models.length ? (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Model" disabled={disabled}>
      {(models.includes(value) ? models : [value, ...models]).map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </Select>
  ) : (
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} disabled={disabled} aria-label="Model" />
  );
}

export function AiModelFields({ settings, onChange, disabled, permissionHint = "", models, modelsError, modelsPending, onRefresh }: AiModelFieldsProps) {
  const cloud = useCloudModels();
  const openai = settings.provider === "openai";
  const anthropic = settings.provider === "anthropic";
  const gemini = settings.provider === "gemini";
  const xai = settings.provider === "xai";
  const pickProvider = (v: string): AiProvider => (v === "openai" || v === "anthropic" || v === "gemini" || v === "xai" ? v : "ollama");
  /** Cloud providers read "Save" once a key is typed: it checks the key and loads the models it can use. */
  const refreshLabel = (title: string, onClick: () => void, apiKey?: string) => (
    <SaveLink title={title} onClick={onClick} apiKey={apiKey} pending={cloud.pending} justSaved={cloud.justSaved} count={cloud.models?.length} disabled={disabled} />
  );
  /** The model box glows green once when the list has just loaded. */
  const glow = cloud.justSaved ? "rf-saved-glow rounded-lg" : undefined;
  return (
    <div className="space-y-2">
      <Field label="Provider">
        <Select value={settings.provider} onChange={(e) => onChange({ provider: pickProvider(e.target.value) })} aria-label="AI provider" disabled={disabled}>
          <option value="ollama">Ollama on this computer</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="gemini">Google (Gemini)</option>
          <option value="xai">xAI (Grok)</option>
          <option value="openai">OpenAI-compatible API</option>
        </Select>
      </Field>
      {xai ? (
        <>
          <Field label="Model" right={refreshLabel("List the Grok models this key can use", () => void cloud.refresh(() => listXaiModels(settings.xaiKey, AbortSignal.timeout(20000)), settings.xaiKey), settings.xaiKey)}>
            <div className={glow}>
              <ModelPicker value={settings.xaiModel} models={cloud.models} onChange={(m) => onChange({ xaiModel: m })} placeholder={DEFAULT_AI_SETTINGS.xaiModel} disabled={disabled} />
            </div>
            {cloud.pending && <p className="rf-read-note mt-1">Listing models…</p>}
            {cloud.error && <p className="mt-1 text-[11px] text-sys-orange">{cloud.error}</p>}
          </Field>
          <Field label="xAI API key">
            <Input type="password" value={settings.xaiKey} onChange={(e) => onChange({ xaiKey: e.target.value })} placeholder="xai-…" spellCheck={false} autoComplete="off" disabled={disabled} aria-label="API key" />
          </Field>
          <p className="rf-read-note" data-ai-disclaimer>
            Sends the transcript (not the video) to xAI under its terms and is billed to your key, which stays in this browser and is only sent to api.x.ai. Get a key at console.x.ai. The Ollama option keeps everything on this computer.
          </p>
        </>
      ) : gemini ? (
        <>
          <Field label="Model" right={refreshLabel("List the Gemini models this key can use", () => void cloud.refresh(() => listGeminiModels(settings.geminiKey, AbortSignal.timeout(20000)), settings.geminiKey), settings.geminiKey)}>
            <div className={glow}>
              <ModelPicker value={settings.geminiModel} models={cloud.models} onChange={(m) => onChange({ geminiModel: m })} placeholder={DEFAULT_AI_SETTINGS.geminiModel} disabled={disabled} />
            </div>
            {cloud.pending && <p className="rf-read-note mt-1">Listing models…</p>}
            {cloud.error && <p className="mt-1 text-[11px] text-sys-orange">{cloud.error}</p>}
          </Field>
          <Field label="Google AI Studio API key">
            <Input type="password" value={settings.geminiKey} onChange={(e) => onChange({ geminiKey: e.target.value })} placeholder="AIza…" spellCheck={false} autoComplete="off" disabled={disabled} aria-label="API key" />
          </Field>
          <p className="rf-read-note" data-ai-disclaimer>
            Sends the transcript (not the video) to Google under its terms and is billed to your key, which stays in this browser and is only sent to generativelanguage.googleapis.com. Get a free key at aistudio.google.com (<a href={withBase("/docs/#api-key")} target="_blank" rel="noreferrer" className="text-sys-blue hover:underline">step-by-step guide</a>). The Ollama option keeps everything on this computer.
          </p>
        </>
      ) : anthropic ? (
        <>
          <Field label="Model" right={refreshLabel("List the Claude models this key can use", () => void cloud.refresh(() => listAnthropicModels(settings.anthropicKey, AbortSignal.timeout(20000)), settings.anthropicKey), settings.anthropicKey)}>
            <div className={glow}>
              <ModelPicker value={settings.anthropicModel} models={cloud.models} onChange={(m) => onChange({ anthropicModel: m })} placeholder={DEFAULT_AI_SETTINGS.anthropicModel} disabled={disabled} />
            </div>
            {cloud.pending && <p className="rf-read-note mt-1">Listing models…</p>}
            {cloud.error && <p className="mt-1 text-[11px] text-sys-orange">{cloud.error}</p>}
          </Field>
          <Field label="Anthropic API key">
            <Input type="password" value={settings.anthropicKey} onChange={(e) => onChange({ anthropicKey: e.target.value })} placeholder="sk-ant-…" spellCheck={false} autoComplete="off" disabled={disabled} aria-label="API key" />
          </Field>
          <p className="rf-read-note" data-ai-disclaimer>
            Sends the transcript (not the video) to Anthropic under its terms and is billed to your key, which stays in this browser and is only sent to api.anthropic.com. Get a key at console.anthropic.com. The Ollama option keeps everything on this computer.
          </p>
        </>
      ) : openai ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Model" right={refreshLabel("List the models this key can use", () => void cloud.refresh(() => listOpenAiModels(settings.apiBase, settings.apiKey, AbortSignal.timeout(20000)), settings.apiKey), settings.apiKey)}>
              <div className={glow}>
              <ModelPicker value={settings.apiModel} models={cloud.models} onChange={(m) => onChange({ apiModel: m })} placeholder={DEFAULT_AI_SETTINGS.apiModel} disabled={disabled} />
            </div>
              {cloud.pending && <p className="rf-read-note mt-1">Listing models…</p>}
              {cloud.error && <p className="mt-1 text-[11px] text-sys-orange">{cloud.error}</p>}
            </Field>
            <Field label="Base URL">
              <Input value={settings.apiBase} onChange={(e) => onChange({ apiBase: e.target.value })} placeholder={DEFAULT_AI_SETTINGS.apiBase} spellCheck={false} disabled={disabled} aria-label="API base URL" />
            </Field>
          </div>
          <Field label="API key">
            <Input type="password" value={settings.apiKey} onChange={(e) => onChange({ apiKey: e.target.value })} placeholder="sk-…" spellCheck={false} autoComplete="off" disabled={disabled} aria-label="API key" />
          </Field>
          <p className="rf-read-note" data-ai-disclaimer>
            Sends the transcript (not the video) to this provider under its terms; your key stays in this browser and is only sent to the base URL above. Works with OpenAI, Groq, OpenRouter, LM Studio and Ollama&apos;s /v1 endpoint. The Ollama option keeps everything on this computer.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Model" right={onRefresh ? <SaveLink title="Refresh local models" onClick={onRefresh} pending={modelsPending} disabled={disabled} /> : undefined}>
              <ModelPicker value={settings.model} models={models} onChange={(m) => onChange({ model: m })} placeholder={DEFAULT_AI_SETTINGS.model} disabled={disabled} />
              {modelsPending && !models && <p className="rf-read-note mt-1">Listing the models on this computer…{permissionHint}</p>}
              {modelsError && <p className="mt-1 text-[11px] text-sys-orange">{modelsError}</p>}
            </Field>
            <Field label="Ollama server">
              <Input value={settings.endpoint} onChange={(e) => onChange({ endpoint: e.target.value })} placeholder={DEFAULT_AI_SETTINGS.endpoint} spellCheck={false} disabled={disabled} aria-label="Ollama server" />
            </Field>
          </div>
          <p className="rf-read-note flex items-start gap-2" data-ai-disclaimer>
            <ShieldCheck size={14} className="mt-[2px] shrink-0 text-sys-green" />
            <span>
              Runs on this computer. <b>Nothing leaves it.</b>
            </span>
          </p>
        </>
      )}
    </div>
  );
}

/** Re-exported so callers keep one import for the Ollama list. */
export { listOllamaModels };
