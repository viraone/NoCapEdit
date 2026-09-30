"use client";
/**
 * Provider and model picker for the transcript-reading AI, shared by the Reels
 * and Subtitles panels. Ollama on this computer is the default and keeps
 * everything local; an OpenAI-compatible API is opt-in for people who bring
 * their own key, and is told plainly that the transcript leaves the device.
 */
import { useState } from "react";
import { RefreshCw } from "lucide-react";
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
  const refresh = async (load: () => Promise<string[]>, apiKey: string) => {
    setError(null);
    if (!apiKey) {
      setModels(null);
      setError("Add your API key first.");
      return;
    }
    setPending(true);
    try {
      setModels(await load());
    } catch (e) {
      setModels(null);
      setError(e instanceof Error ? e.message : "Couldn't list models.");
    } finally {
      setPending(false);
    }
  };
  return { models, error, pending, refresh };
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
  const refreshLabel = (title: string, onClick: () => void) => (
    <button type="button" className="text-sys-blue hover:underline" onClick={onClick} title={title} disabled={disabled}>
      <RefreshCw size={11} className="inline" /> refresh
    </button>
  );
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
          <Field label="Model" right={refreshLabel("List the Grok models this key can use", () => void cloud.refresh(() => listXaiModels(settings.xaiKey, AbortSignal.timeout(20000)), settings.xaiKey))}>
            <ModelPicker value={settings.xaiModel} models={cloud.models} onChange={(m) => onChange({ xaiModel: m })} placeholder={DEFAULT_AI_SETTINGS.xaiModel} disabled={disabled} />
            {cloud.pending && <p className="mt-1 text-[11px] text-label-3">Listing models…</p>}
            {cloud.error && <p className="mt-1 text-[11px] text-sys-orange">{cloud.error}</p>}
          </Field>
          <Field label="xAI API key">
            <Input type="password" value={settings.xaiKey} onChange={(e) => onChange({ xaiKey: e.target.value })} placeholder="xai-…" spellCheck={false} autoComplete="off" disabled={disabled} aria-label="API key" />
          </Field>
          <p className="text-[11px] text-label-3" data-ai-disclaimer>
            Sends the transcript (not the video) to xAI under its terms and is billed to your key, which stays in this browser and is only sent to api.x.ai. Get a key at console.x.ai. The Ollama option keeps everything on this computer.
          </p>
        </>
      ) : gemini ? (
        <>
          <Field label="Model" right={refreshLabel("List the Gemini models this key can use", () => void cloud.refresh(() => listGeminiModels(settings.geminiKey, AbortSignal.timeout(20000)), settings.geminiKey))}>
            <ModelPicker value={settings.geminiModel} models={cloud.models} onChange={(m) => onChange({ geminiModel: m })} placeholder={DEFAULT_AI_SETTINGS.geminiModel} disabled={disabled} />
            {cloud.pending && <p className="mt-1 text-[11px] text-label-3">Listing models…</p>}
            {cloud.error && <p className="mt-1 text-[11px] text-sys-orange">{cloud.error}</p>}
          </Field>
          <Field label="Google AI Studio API key">
            <Input type="password" value={settings.geminiKey} onChange={(e) => onChange({ geminiKey: e.target.value })} placeholder="AIza…" spellCheck={false} autoComplete="off" disabled={disabled} aria-label="API key" />
          </Field>
          <p className="text-[11px] text-label-3" data-ai-disclaimer>
            Sends the transcript (not the video) to Google under its terms and is billed to your key, which stays in this browser and is only sent to generativelanguage.googleapis.com. Get a key at aistudio.google.com. The Ollama option keeps everything on this computer.
          </p>
        </>
      ) : anthropic ? (
        <>
          <Field label="Model" right={refreshLabel("List the Claude models this key can use", () => void cloud.refresh(() => listAnthropicModels(settings.anthropicKey, AbortSignal.timeout(20000)), settings.anthropicKey))}>
            <ModelPicker value={settings.anthropicModel} models={cloud.models} onChange={(m) => onChange({ anthropicModel: m })} placeholder={DEFAULT_AI_SETTINGS.anthropicModel} disabled={disabled} />
            {cloud.pending && <p className="mt-1 text-[11px] text-label-3">Listing models…</p>}
            {cloud.error && <p className="mt-1 text-[11px] text-sys-orange">{cloud.error}</p>}
          </Field>
          <Field label="Anthropic API key">
            <Input type="password" value={settings.anthropicKey} onChange={(e) => onChange({ anthropicKey: e.target.value })} placeholder="sk-ant-…" spellCheck={false} autoComplete="off" disabled={disabled} aria-label="API key" />
          </Field>
          <p className="text-[11px] text-label-3" data-ai-disclaimer>
            Sends the transcript (not the video) to Anthropic under its terms and is billed to your key, which stays in this browser and is only sent to api.anthropic.com. Get a key at console.anthropic.com. The Ollama option keeps everything on this computer.
          </p>
        </>
      ) : openai ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Model" right={refreshLabel("List the models this key can use", () => void cloud.refresh(() => listOpenAiModels(settings.apiBase, settings.apiKey, AbortSignal.timeout(20000)), settings.apiKey))}>
              <ModelPicker value={settings.apiModel} models={cloud.models} onChange={(m) => onChange({ apiModel: m })} placeholder={DEFAULT_AI_SETTINGS.apiModel} disabled={disabled} />
              {cloud.pending && <p className="mt-1 text-[11px] text-label-3">Listing models…</p>}
              {cloud.error && <p className="mt-1 text-[11px] text-sys-orange">{cloud.error}</p>}
            </Field>
            <Field label="Base URL">
              <Input value={settings.apiBase} onChange={(e) => onChange({ apiBase: e.target.value })} placeholder={DEFAULT_AI_SETTINGS.apiBase} spellCheck={false} disabled={disabled} aria-label="API base URL" />
            </Field>
          </div>
          <Field label="API key">
            <Input type="password" value={settings.apiKey} onChange={(e) => onChange({ apiKey: e.target.value })} placeholder="sk-…" spellCheck={false} autoComplete="off" disabled={disabled} aria-label="API key" />
          </Field>
          <p className="text-[11px] text-label-3" data-ai-disclaimer>
            Sends the transcript (not the video) to this provider under its terms; your key stays in this browser and is only sent to the base URL above. Works with OpenAI, Groq, OpenRouter, LM Studio and Ollama&apos;s /v1 endpoint. The Ollama option keeps everything on this computer.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Model" right={onRefresh ? refreshLabel("Refresh local models", onRefresh) : undefined}>
              <ModelPicker value={settings.model} models={models} onChange={(m) => onChange({ model: m })} placeholder={DEFAULT_AI_SETTINGS.model} disabled={disabled} />
              {modelsPending && !models && <p className="mt-1 text-[11px] text-label-3">Listing the models on this computer…{permissionHint}</p>}
              {modelsError && <p className="mt-1 text-[11px] text-sys-orange">{modelsError}</p>}
            </Field>
            <Field label="Ollama server">
              <Input value={settings.endpoint} onChange={(e) => onChange({ endpoint: e.target.value })} placeholder={DEFAULT_AI_SETTINGS.endpoint} spellCheck={false} disabled={disabled} aria-label="Ollama server" />
            </Field>
          </div>
          <p className="text-[11px] text-label-3" data-ai-disclaimer>
            Everything runs on this computer; nothing leaves it.
          </p>
        </>
      )}
    </div>
  );
}

/** Re-exported so callers keep one import for the Ollama list. */
export { listOllamaModels };
