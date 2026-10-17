import { Hourglass } from "lucide-react";
import { cx } from "@/lib/utils/cx";

/**
 * The "please wait" notice shown while a pasted link downloads. Closing the tab or
 * leaving the start page (opening a project, the How-to page) stops the download, so
 * it says so in plain words and tells the visitor where the result will turn up.
 */
export function DownloadingNotice({ format, folder = null, className }: { format: "mp4" | "mp3"; /** The folder the visitor chose to save into, if any. */ folder?: string | null; className?: string }) {
  const where = folder ? `your ${folder} folder` : "your Downloads folder";
  return (
    <div className={cx("flex items-start gap-2.5 rounded-xl border border-sys-orange/60 bg-sys-orange/15 px-3 py-2.5", className)} data-downloading-notice>
      <Hourglass size={18} className="mt-0.5 shrink-0 text-sys-orange" aria-hidden />
      <p className="text-sm leading-snug text-white">
        <b className="font-bold">Please wait. Don&apos;t close this page or open anything else until it&apos;s done.</b> Let it finish downloading;{" "}
        {format === "mp3" ? `the MP3 will land in ${where} by itself.` : `it will land in ${where} and show up under Your projects by itself.`}
      </p>
    </div>
  );
}
