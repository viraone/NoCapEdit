"use client";
import { AlertTriangle, ArrowLeft, Check, Download, RotateCcw, Share2 } from "lucide-react";
import type { LiteExportResult } from "@/lib/mobile/exportLite";
import { canShareFiles } from "@/lib/mobile/share";
import { ActionBar, PrimaryButton, SecondaryButton } from "./MobileChrome";
import { fmtTime } from "./mobileHelpers";

export function DoneScreen({
  result,
  resultUrl,
  saved,
  onSave,
  onEdit,
  onNew,
}: {
  result: LiteExportResult;
  resultUrl: string;
  saved: "shared" | "downloaded" | null;
  onSave: () => void;
  onEdit: () => void;
  onNew: () => void;
}) {
  const share = canShareFiles();
  const mb = (result.blob.size / 1_048_576).toFixed(1);
  return (
    <div className="flex flex-1 flex-col">
      <div className="overflow-hidden rounded-[24px] bg-black shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
        <video src={`${resultUrl}#t=0.1`} controls playsInline preload="auto" className="block max-h-[56dvh] w-full bg-black object-contain" />
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-label-2">
        <span data-export-engine={result.engine} className="inline-flex items-center gap-1 rounded-full bg-sys-green/15 px-2 py-0.5 font-medium text-sys-green"><Check size={12} /> Ready</span>
        <span>{result.width}×{result.height}</span>
        <span>·</span>
        <span>{fmtTime(result.seconds)}</span>
        <span>·</span>
        <span>{mb} MB</span>
        <span>·</span>
        <span>{result.audio === "none" ? "no audio" : "with audio"}</span>
      </div>
      {result.audioDropped ? (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-sys-orange/10 p-3 text-[12px] text-sys-orange">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Exported without sound — the audio couldn&rsquo;t be added.
        </p>
      ) : result.audio === "none" ? (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-sys-orange/10 p-3 text-[12px] text-sys-orange">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> This browser couldn&rsquo;t encode audio, so the export is silent. Safari 17+ or Chrome keeps the sound.
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SecondaryButton onClick={onEdit}><ArrowLeft size={16} /> Adjust</SecondaryButton>
        <SecondaryButton onClick={onNew}><RotateCcw size={16} /> New video</SecondaryButton>
      </div>
      <div className="flex-1" />
      <ActionBar>
        <PrimaryButton onClick={onSave}>
          {share ? <Share2 size={18} /> : <Download size={18} />} {share ? "Save to Photos" : "Download MP4"}
        </PrimaryButton>
        {saved && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] text-sys-green">
            <Check size={16} /> {saved === "shared" ? "Choose “Save Video” in the share sheet." : "Downloaded."}
          </p>
        )}
      </ActionBar>
    </div>
  );
}
