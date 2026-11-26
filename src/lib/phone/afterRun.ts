import type { ReelOutcome } from "./phoneBridge";

export type AfterRun = "stopped" | "failed" | "trim" | "editor" | "held" | "countdown" | "ready";

/**
 * What the Story and Post / Reel windows do once the phone has been walked through;
 * Share is only ever counted down to when nothing asked for was missed and Stop was not pressed.
 */
export function afterRun(outcome: ReelOutcome, share: boolean, cancelled: boolean): AfterRun {
  if (cancelled || outcome.stoppedAt === "cancelled") return "stopped";
  if (!outcome.ready) {
    if (outcome.stoppedAt === "trim" || outcome.stoppedAt === "editor") return outcome.stoppedAt;
    return "failed";
  }
  if (share && (outcome.problems?.length ?? 0) > 0) return "held";
  if (share) return "countdown";
  return "ready";
}
