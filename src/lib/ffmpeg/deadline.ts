/**
 * Puts a time limit on a call that might never come back. ffmpeg.wasm talks to
 * its worker by message and has no time limit of its own: if the worker dies or
 * a pthread never reports ready, the promise just stays pending and the page
 * waits forever. On expiry `onTimeout` runs once (it should recycle whatever is
 * stuck) and its Error becomes the rejection.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(onTimeout());
    }, ms);
    promise.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
