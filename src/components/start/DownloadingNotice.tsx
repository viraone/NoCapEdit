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
    <div className={cx("flex items-start gap-3 rounded-xl border border-sys-orange/60 bg-sys-orange/15 px-3.5 py-3", className)} data-downloading-notice>
      <Hourglass size={20} className="mt-0.5 shrink-0 text-sys-orange" aria-hidden />
      <p className="text-[15px] leading-normal text-white">
        <b className="font-bold">Please wait. Don&apos;t close this page or open anything.</b>{" "}
        {format === "mp3" ? `The MP3 will land in ${where}.` : `The video will land in ${where} and show up under Your projects.`}
      </p>
    </div>
  );
}
