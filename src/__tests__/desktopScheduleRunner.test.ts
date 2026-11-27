import { describe, expect, it } from "vitest";
import { createScheduleRunner } from "../../desktop/lib/scheduleRunner.mjs";
import { emptyQueue, newItem } from "../../desktop/lib/schedule.mjs";

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
  const runner = createScheduleRunner({
    queue: { ...emptyQueue(), items },
    save: (q: Queue) => {
      if (flags.saveThrows) throw new Error("disk");
      saved.push(JSON.parse(JSON.stringify(q)) as Queue);
    },
    now: () => NOW,
    post: (_item: Item, hooks: Hooks) => new Promise<PostResult>((resolve, reject) => posts.push({ hooks, resolve, reject })),
    stopPost: () => {},
    warmUp: () => {},
    notify: () => {},
    changed: () => {},
  });
  return { runner, saved, posts, flags };
}

describe("desktopScheduleRunner", () => {
  it("shares item when beforeShare returns true", async () => {
    const h = harness([item()]);
    const done = h.runner.tick();
    expect(h.posts[0].hooks.beforeShare()).toBe(true);
    expect(h.saved.at(-1)!.items[0].status).toBe("sharing");
    h.posts[0].resolve({ shared: true });
    await done;
    expect(h.runner.state().queue.items[0].status).toBe("shared");
    expect(h.runner.state().queue.lastSharedAt).toBe(NOW);
  });

  it("does not add a second post on subsequent tick", async () => {
    const h = harness([item()]);
    const done = h.runner.tick();
    h.runner.tick();
    expect(h.posts.length).toBe(1);
    h.posts[0].resolve({ shared: true });
    await done;
  });

  it("handles post rejection", async () => {
    const h = harness([item()]);
    const done = h.runner.tick();
    h.posts[0].hooks.beforeShare();
    h.posts[0].reject(new Error("boom"));
    await done;
    expect(h.runner.state().queue.items[0].status).toBe("needsYou");
    expect(h.runner.state().queue.items[0].maybePosted).toBe(true);
    await h.runner.tick();
    expect(h.posts.length).toBe(1);
  });

  it("handles stop before beforeShare", async () => {
    const h = harness([item()]);
    const done = h.runner.tick();
    h.runner.stop();
    expect(h.posts[0].hooks.beforeShare()).toBe(false);
    h.posts[0].resolve({ shared: false, why: "Stopped." });
    await done;
    expect(h.runner.state().queue.items[0].status).toBe("needsYou");
    expect(h.runner.state().queue.items[0].maybePosted).toBe(false);
  });

  it("returns false from beforeShare if save throws", async () => {
    const h = harness([item()]);
    const done = h.runner.tick();
    h.flags.saveThrows = true;
    expect(h.posts[0].hooks.beforeShare()).toBe(false);
    h.posts[0].resolve({ shared: false });
    await done;
  });

  it("recovers item with status sharing", async () => {
    const h = harness([{ ...item(), status: "sharing" as const }]);
    expect(h.runner.state().queue.items[0].status).toBe("needsYou");
    expect(h.runner.state().queue.items[0].maybePosted).toBe(true);
    await h.runner.tick();
    expect(h.posts.length).toBe(0);
  });
});
