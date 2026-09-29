"use client";
/**
 * Provider and model picker for the transcript-reading AI, shared by the Reels
 * and Subtitles panels. Ollama on this computer is the default and keeps
 * everything local; an OpenAI-compatible API is opt-in for people who bring
 * their own key, and is told plainly that the transcript leaves the device.
 */
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { DEFAULT_AI_SETTINGS, listOllamaModels, listOpenAiModels, type AiSettings } from "@/lib/edit/aiHighlights";
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

/** Reusable fetch of the OpenAI-compatible model list, with the same shape as the Ollama one. */
export function useOpenAiModels() {
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const refresh = async (apiBase: string, apiKey: string) => {
    setError(null);
    if (!apiKey) {
      setModels(null);
      setError("Add your API key first.");
      return;
    }
    setPending(true);
    try {
      setModels(await listOpenAiModels(apiBase, apiKey, AbortSignal.timeout(20000)));
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
  const cloud = useOpenAiModels();
  const openai = settings.provider === "openai";
  const refreshLabel = (title: string, onClick: () => void) => (
    <button type="button" className="text-sys-blue hover:underline" onClick={onClick} title={title} disabled={disabled}>
      <RefreshCw size={11} className="inline" /> refresh
    </button>
  );
  return (
    <div className="space-y-2">
      <Field label="Provider">
        <Select value={settings.provider} onChange={(e) => onChange({ provider: e.target.value === "openai" ? "openai" : "ollama" })} aria-label="AI provider" disabled={disabled}>
          <option value="ollama">Ollama on this computer</option>
          <option value="openai">OpenAI-compatible API</option>
        </Select>
      </Field>
      {openai ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Model" right={refreshLabel("List the models this key can use", () => void cloud.refresh(settings.apiBase, settings.apiKey))}>
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
