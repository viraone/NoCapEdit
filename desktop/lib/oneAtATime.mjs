/**
 * Error thrown when a job is already running and has not been cancelled.
 */
export class Busy extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
  }
}

/**
 * @typedef {{ cancelled: boolean }} Job
 * @typedef {<T>(work: (job: Job) => Promise<T>) => Promise<T>} RunFn
 * @typedef {{ run: RunFn, cancel: () => void }} Gate
 */

/**
 * Creates a gate that lets only one job work at a time.
 * @returns {Gate}
 */
export function createGate() {
  /** @type {null | { job: Job, done: Promise<void> }} */
  let current = null;
  /** @type {Set<Job>} */
  const waiting = new Set();

  /**
   * @template T
   * @param {(job: Job) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async function run(work) {
    /** @type {Job} */
    const job = { cancelled: false };
    waiting.add(job);

    while (current) {
      if (!current.job.cancelled) {
        waiting.delete(job);
        throw new Busy("Instagram is still busy with another step. Wait for it to finish, or press Stop first.");
      }
      await current.done;
    }

    waiting.delete(job);
    let resolveDone;
    /** @type {Promise<void>} */
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    current = { job, done };

    try {
      return await work(job);
    } finally {
      current = null;
      resolveDone();
    }
  }

  /**
   * Cancels the working job and every waiting job.
   */
  function cancel() {
    if (current) {
      current.job.cancelled = true;
    }
    for (const job of waiting) {
      job.cancelled = true;
    }
  }

  return { run, cancel };
}
