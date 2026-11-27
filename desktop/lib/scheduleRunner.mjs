import { LATE_LIMIT_MS, dueItem, headsUp, markMissed, postponed, recover } from "./schedule.mjs";

/**
 * @typedef {import("./schedule.mjs").Item} Item
 * @typedef {import("./schedule.mjs").Queue} Queue
 * @typedef {import("./schedule.mjs").Wanted} Wanted
 * @typedef {{ ok: true } | { ok: false, why: string }} Result
 * @typedef {{ shared: boolean, why?: string, details?: string[], tapped?: boolean }} PostResult
 * @typedef {{ queue: Queue, save(queue: Queue): void, now(): number, post(item: Item, hooks: { beforeShare(): boolean }): Promise<PostResult>, stopPost(): void, warmUp(item: Item): void, notify(kind: "headsUp" | "shared" | "needsYou" | "missed", item: Item): void, changed(): void }} Deps
 */

const SAVE_FAIL = "Could not save the schedule to disk.";
const NOT_FOUND = "That post is no longer in the list.";
const BUSY = "It is being posted right now. Press Stop first.";
const ALREADY = "It has already been posted.";
const PAUSED = "Scheduling is paused. Press Resume first.";
const NOT_WAITING = "Only a post that is still waiting can be postponed.";

/**
 * @param {Deps} deps
 */
export function createScheduleRunner(deps) {
  const recovered = recover(deps.queue);
  let queue = recovered;
  if (JSON.stringify(recovered) !== JSON.stringify(deps.queue)) {
    try {
      deps.save(queue);
    } catch {
      // keep in memory even if the disk write fails
    }
  }

  /** @type {string | null} */
  let running = null;
  let stopAsked = false;

  /**
   * @param {string} id
   * @returns {Item | null}
   */
  function find(id) {
    return queue.items.find((item) => item.id === id) ?? null;
  }

  /**
   * @param {Queue} next
   * @returns {Result}
   */
  function commit(next) {
    try {
      deps.save(next);
    } catch {
      return { ok: false, why: SAVE_FAIL };
    }
    queue = next;
    deps.changed();
    return { ok: true };
  }

  /**
   * @param {Queue} next
   * @param {Item} item
   * @returns {Queue}
   */
  function replaceItem(next, item) {
    return { ...next, items: next.items.map((i) => (i.id === item.id ? item : i)) };
  }

  return {
    state() {
      return { queue, running };
    },

    /**
     * @param {Item} item
     */
    add(item) {
      const next = { ...queue, items: [...queue.items, item] };
      deps.save(next);
      queue = next;
      deps.changed();
    },

    /**
     * @param {string} id
     * @param {Wanted} value
     * @returns {Result}
     */
    change(id, value) {
      const item = find(id);
      if (!item) return { ok: false, why: NOT_FOUND };
      if (item.status === "posting" || item.status === "sharing") return { ok: false, why: BUSY };
      if (item.status === "shared") return { ok: false, why: ALREADY };
      const updated = {
        ...item,
        at: value.at,
        audience: value.audience,
        highlight: value.highlight,
        options: value.options,
        status: "scheduled",
        note: "",
        details: [],
        warned: false,
        maybePosted: false,
        finishedAt: null,
      };
      return commit(replaceItem(queue, updated));
    },

    /**
     * @param {string} id
     * @returns {Result}
     */
    remove(id) {
      const item = find(id);
      if (!item) return { ok: false, why: NOT_FOUND };
      if (item.status === "posting" || item.status === "sharing") return { ok: false, why: BUSY };
      const next = { ...queue, items: queue.items.filter((i) => i.id !== id) };
      return commit(next);
    },

    /**
     * @param {string} id
     * @returns {Result}
     */
    postNow(id) {
      const item = find(id);
      if (!item) return { ok: false, why: NOT_FOUND };
      if (item.status === "posting" || item.status === "sharing") return { ok: false, why: BUSY };
      if (item.status === "shared") return { ok: false, why: ALREADY };
      if (queue.paused) return { ok: false, why: PAUSED };
      const updated = {
        ...item,
        at: deps.now(),
        status: "scheduled",
        warned: true,
        note: "",
        details: [],
        maybePosted: false,
        finishedAt: null,
      };
      return commit(replaceItem(queue, updated));
    },

    /**
     * @param {string} id
     * @returns {Result}
     */
    postpone(id) {
      const item = find(id);
      if (!item) return { ok: false, why: NOT_FOUND };
      if (item.status !== "scheduled") return { ok: false, why: NOT_WAITING };
      const updated = postponed(item, deps.now());
      return commit(replaceItem(queue, updated));
    },

    /**
     * @param {boolean} paused
     */
    setPaused(paused) {
      const next = { ...queue, paused };
      if (paused) {
        queue = next;
        try {
          deps.save(next);
        } catch {
          // pausing must always work
        }
        deps.changed();
        return;
      }
      deps.save(next);
      queue = next;
      deps.changed();
    },

    stop() {
      if (running === null) return;
      stopAsked = true;
      deps.stopPost();
    },

    async tick() {
      // 1. mark missed
      const missedResult = markMissed(queue, deps.now());
      if (missedResult.missed.length > 0) {
        queue = missedResult.queue;
        try {
          deps.save(queue);
        } catch {
          // keep in memory even if save throws
        }
        for (const item of missedResult.missed) {
          deps.notify("missed", item);
        }
        deps.changed();
      }

      // 2. heads up
      const warned = headsUp(queue, deps.now());
      if (warned.length > 0) {
        const items = queue.items.map((item) =>
          warned.some((w) => w.id === item.id) ? { ...item, warned: true } : item,
        );
        queue = { ...queue, items };
        try {
          deps.save(queue);
        } catch {
          // keep in memory even if save throws
        }
        for (const item of warned) {
          deps.warmUp(item);
          deps.notify("headsUp", item);
        }
        deps.changed();
      }

      // 3. if running, return
      if (running !== null) return;

      const item = dueItem(queue, deps.now());
      if (!item) return;

      // 4. set running, clear stop flag, set status posting, save
      running = item.id;
      stopAsked = false;
      const postingItem = { ...item, status: "posting" };
      queue = replaceItem(queue, postingItem);
      try {
        deps.save(queue);
      } catch {
        queue = replaceItem(queue, { ...postingItem, status: "scheduled" });
        running = null;
        return;
      }
      deps.changed();

      // 5. post
      /** @type {PostResult} */
      let result;
      try {
        result = await deps.post(postingItem, {
          beforeShare() {
            const current = find(item.id);
            if (!current || current.status !== "posting") return false;
            if (stopAsked) return false;
            if (queue.paused) return false;
            if (deps.now() > item.at + LATE_LIMIT_MS) return false;
            const sharingItem = { ...current, status: "sharing" };
            const next = replaceItem(queue, sharingItem);
            try {
              deps.save(next);
            } catch {
              return false;
            }
            queue = next;
            deps.changed();
            return true;
          },
        });
      } catch (error) {
        result = { shared: false, why: error instanceof Error ? error.message : String(error) };
      }

      // 6. finalize
      const current = find(item.id);
      if (current) {
        const wasSharing = current.status === "sharing";
        let updated;
        if (result.shared) {
          updated = {
            ...current,
            status: "shared",
            note: "",
            details: result.details ?? [],
            maybePosted: false,
            finishedAt: deps.now(),
          };
          queue = { ...replaceItem(queue, updated), lastSharedAt: deps.now() };
          deps.notify("shared", updated);
        } else {
          updated = {
            ...current,
            status: "needsYou",
            note: result.why || "A step failed.",
            details: result.details ?? [],
            maybePosted: wasSharing && result.tapped !== false,
            finishedAt: deps.now(),
          };
          queue = replaceItem(queue, updated);
          deps.notify("needsYou", updated);
        }
      }

      running = null;
      try {
        deps.save(queue);
      } catch {
        // keep in memory even if save throws
      }
      deps.changed();
    },
  };
}
