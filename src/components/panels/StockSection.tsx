"use client";
import { useState } from "react";
import { Search, Download, KeyRound, ExternalLink } from "lucide-react";
import { getStockKey, setStockKey, searchStock, downloadStock, type StockProvider, type StockVideo } from "@/lib/stock/providers";
import { formatTime } from "@/lib/utils/time";
import { PanelSection } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Input, inputClass } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { ProgressBar } from "@/components/ui/ProgressBar";

/** Royalty-free footage search (Pexels / Pixabay) that feeds the clip importer. */
export function StockSection({ onImport, disabled }: { onImport: (files: File[]) => Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<StockProvider>("pexels");
  const [key, setKey] = useState(() => getStockKey("pexels"));
  const [query, setQuery] = useState("");
  const [orientation, setOrientation] = useState<"" | "portrait" | "landscape" | "square">("portrait");
  const [results, setResults] = useState<StockVideo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchProvider = (p: StockProvider) => {
    setProvider(p);
    setKey(getStockKey(p));
    setResults([]);
  };

  const search = async () => {
    setError(null);
    setStockKey(provider, key.trim());
    if (!query.trim()) return;
    setBusy("Searching…");
    try {
      setResults(await searchStock(provider, query.trim(), orientation));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const add = async (item: StockVideo) => {
    setError(null);
    setBusy(`Downloading ${item.title}`);
    setProgress(null);
    try {
      const file = await downloadStock(item, (loaded, total) => setProgress(total ? loaded / total : null));
      await onImport([file]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <PanelSection
      title="Stock footage"
      right={
        <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Search Pexels / Pixabay"}
        </Button>
      }
    >
      {open && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Provider">
              <Select value={provider} onChange={(e) => switchProvider(e.target.value as StockProvider)}>
                <option value="pexels">Pexels</option>
                <option value="pixabay">Pixabay</option>
              </Select>
            </Field>
            <Field label="Orientation">
              <Select value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)}>
                <option value="portrait">Vertical</option>
                <option value="landscape">Landscape</option>
                <option value="square">Square</option>
                <option value="">Any</option>
              </Select>
            </Field>
          </div>
          <Field label="API key" hint={provider === "pexels" ? "Free at pexels.com/api — stored only in this browser." : "Free at pixabay.com/api/docs — stored only in this browser."}>
            <div className="flex items-center gap-1.5">
              <KeyRound size={14} className="shrink-0 text-label-3" />
              <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
            </div>
          </Field>
          <div className="flex gap-1.5">
            <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. city night, coffee, ocean" onKeyDown={(e) => e.key === "Enter" && search()} />
            <Button variant="secondary" size="md" onClick={search} disabled={!!busy || !query.trim()}>
              <Search size={14} />
            </Button>
          </div>
          {busy && (
            <div>
              <ProgressBar value={progress} />
              <p className="mt-1 text-[11px] text-label-2">{busy}</p>
            </div>
          )}
          {error && <p className="text-[11px] text-sys-red">{error}</p>}
          {results.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {results.map((r) => (
                <div key={r.id} className="overflow-hidden rounded-md border border-sys-gray4 bg-sys-gray5">
                  <div className="relative aspect-video bg-sys-gray6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums">{formatTime(r.duration, false)}</span>
                  </div>
                  <div className="flex items-center gap-1 px-1.5 py-1">
                    <span className="min-w-0 flex-1 truncate text-[10px] text-label-2" title={`${r.title} · ${r.author}`}>
                      {r.width}×{r.height} · {r.author}
                    </span>
                    <a href={r.pageUrl} target="_blank" rel="noreferrer" className="rounded p-0.5 text-label-3 hover:text-white" title="Open on provider site">
                      <ExternalLink size={11} />
                    </a>
                    <Button variant="ghost" size="xs" onClick={() => add(r)} disabled={!!busy || disabled} title="Download and add to the sequence">
                      <Download size={11} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PanelSection>
  );
}
