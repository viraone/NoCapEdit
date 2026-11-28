import { describe, expect, it } from "vitest";
import { createScheduleRunner } from "../../desktop/lib/scheduleRunner.mjs";
import { emptyQueue, newItem, recover, markMissed, LATE_LIMIT_MS } from "../../desktop/lib/schedule.mjs";

type Item = ReturnType<typeof newItem>;
type Queue = Parameters<typeof createScheduleRunner>[0]["queue"];
type Hooks = { beforeShare(): boolean };
type PostResult = { shared: boolean; why?: string; tapped?: boolean };

const NOW = 1_800_000_000_000;
const OPTIONS = { mute: false, overlay: "", overlayAt: "top" as const, linkUrl: "", linkLabel: "", linkAt: "bottom" as const, music: null };
const item = (): Item => newItem("a", "A", "video", { at: NOW, audience: "story", highlight: "", options: OPTIONS }, NOW);

function harness(items: Item[]) {
  let clock = NOW;
  const saved: Queue[] = [];
  const posts: { hooks: Hooks; resolve: (r: PostResult) => void; reject: (e: Error) => void }[] = [];
  const runner = createScheduleRunner({
    queue: { ...emptyQueue(), items },
    save: (q: Queue) => { saved.push(JSON.parse(JSON.stringify(q)) as Queue); },
    now: () => clock,
    post: (_item: Item, hooks: Hooks) => new Promise<PostResult>((resolve, reject) => posts.push({ hooks, resolve, reject })),
    stopPost: () => {},
    warmUp: () => {},
    notify: () => {},
    changed: () => {},
  });
  return { runner, saved, posts, advance: (ms: number) => { clock += ms; } };
}

describe("desktopScheduleHold", () => {
  it("change keeps maybePosted true", () => {
    const h = harness([{ ...item(), status: "needsYou" as const, maybePosted: true }]);
    expect(h.runner.change("a", { at: NOW + 3600_000, audience: "story", highlight: "", options: OPTIONS })).toEqual({ ok: true });
    expect(h.runner.state().queue.items[0].maybePosted).toBe(true);
  });

  it("postNow then failed post keeps maybePosted true", async () => {
    const h = harness([{ ...item(), status: "needsYou" as const, maybePosted: true }]);
    h.runner.postNow("a");
    const done = h.runner.tick();
    h.posts[0].resolve({ shared: false, why: "x" });
    await done;
    expect(h.runner.state().queue.items[0].status).toBe("needsYou");
    expect(h.runner.state().queue.items[0].maybePosted).toBe(true);
  });

  it("recover and markMissed keep maybePosted true", () => {
    const q = { ...emptyQueue(), items: [{ ...item(), status: "posting" as const, maybePosted: true }] };
    expect(recover(q).items[0].maybePosted).toBe(true);
    const late = { ...emptyQueue(), items: [{ ...item(), status: "scheduled" as const, maybePosted: true }] };
    const res = markMissed(late, NOW + LATE_LIMIT_MS + 1);
    expect(res.missed[0].note).toContain("check Instagram");
  });

  it("hold blocks tick, release after time makes needsYou", async () => {
    const h = harness([item()]);
    expect(h.runner.hold("a")).toEqual({ ok: true });
    await h.runner.tick();
    expect(h.posts.length).toBe(0);
    h.advance(1000);
    h.runner.release("a");
    expect(h.runner.state().queue.items[0].status).toBe("needsYou");
    await h.runner.tick();
    expect(h.posts.length).toBe(0);
  });

  it("release before time keeps scheduled, tick posts after time", async () => {
    const h = harness([{ ...item(), at: NOW + 60_000 }]);
    h.runner.hold("a");
    h.runner.release("a");
    expect(h.runner.state().queue.items[0].status).toBe("scheduled");
    h.advance(60_000);
    const done = h.runner.tick();
    expect(h.posts.length).toBe(1);
    h.posts[0].resolve({ shared: true });
    await done;
  });

  it("hold on posting item returns busy", async () => {
    const h = harness([item()]);
    const done = h.runner.tick();
    expect(h.runner.hold("a")).toEqual({ ok: false, why: "It is being posted right now. Press Stop first." });
    h.posts[0].resolve({ shared: true });
    await done;
  });
});
