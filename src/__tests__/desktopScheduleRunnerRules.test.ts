import { describe, expect, it } from "vitest";
import { createScheduleRunner } from "../../desktop/lib/scheduleRunner.mjs";
import { emptyQueue, newItem, HEADS_UP_MS, LATE_LIMIT_MS } from "../../desktop/lib/schedule.mjs";

type Item = ReturnType<typeof newItem>;
type Queue = Parameters<typeof createScheduleRunner>[0]["queue"];
type Hooks = { beforeShare(): boolean };
type PostResult = { shared: boolean; why?: string; tapped?: boolean };

const NOW = 1_800_000_000_000;
const OPTIONS = { mute: false, overlay: "", overlayAt: "top" as const, linkUrl: "", linkLabel: "", linkAt: "bottom" as const, music: null };
const item = (): Item => newItem("a", "A", "video", { at: NOW, audience: "story", highlight: "", options: OPTIONS }, NOW);

function harness(items: Item[]) {
  const saved: Queue[] = [];
  const posts: { hooks: Hooks; resolve: (r: PostResult) => void; reject: (e: Error) => void }[] = [];
  const flags = { saveThrows: false };
  const events: string[] = [];
  const runner = createScheduleRunner({
    queue: { ...emptyQueue(), items },
    save: (q: Queue) => {
      if (flags.saveThrows) throw new Error("disk");
      saved.push(JSON.parse(JSON.stringify(q)) as Queue);
    },
    now: () => NOW,
    post: (_item: Item, hooks: Hooks) => new Promise<PostResult>((resolve, reject) => posts.push({ hooks, resolve, reject })),
    stopPost: () => {},
    warmUp: () => { events.push("warm"); },
    notify: (kind: string) => { events.push(kind); },
    changed: () => {},
  });
  return { runner, saved, posts, flags, events };
}

describe("desktopScheduleRunnerRules", () => {
  it("misses late item", async () => {
    const h = harness([{ ...item(), at: NOW - LATE_LIMIT_MS - 1 }]);
    await h.runner.tick();
    await h.runner.tick();
    expect(h.runner.state().queue.items[0].status).toBe("missed");
    expect(h.events).toEqual(["missed"]);
    expect(h.posts.length).toBe(0);
  });

  it("warms up and heads up", async () => {
    const h = harness([{ ...item(), at: NOW + HEADS_UP_MS - 1000 }]);
    await h.runner.tick();
    await h.runner.tick();
    expect(h.events).toEqual(["warm", "headsUp"]);
    expect(h.posts.length).toBe(0);
  });

  it("guards postpone, remove, paused postNow", async () => {
    const h = harness([{ ...item(), status: "missed" as const }]);
    expect(h.runner.postpone("a")).toEqual({ ok: false, why: "Only a post that is still waiting can be postponed." });
    expect(h.runner.remove("zz")).toEqual({ ok: false, why: "That post is no longer in the list." });
    h.runner.setPaused(true);
    expect(h.runner.postNow("a")).toEqual({ ok: false, why: "Scheduling is paused. Press Resume first." });
    h.runner.setPaused(false);
    expect(h.runner.postNow("a")).toEqual({ ok: true });
    const done = h.runner.tick();
    expect(h.posts.length).toBe(1);
    h.posts[0].resolve({ shared: true });
    await done;
  });

  it("guards remove and postNow while posting", async () => {
    const h = harness([item()]);
    const done = h.runner.tick();
    expect(h.runner.remove("a")).toEqual({ ok: false, why: "It is being posted right now. Press Stop first." });
    expect(h.runner.postNow("a")).toEqual({ ok: false, why: "It is being posted right now. Press Stop first." });
    h.posts[0].resolve({ shared: true });
    await done;
    expect(h.runner.postNow("a")).toEqual({ ok: false, why: "It has already been posted." });
  });
});
