let count = 0;

function ask(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = "";
}

export function busyJobs(): number {
  return count;
}

export async function whileBusy<T>(work: () => Promise<T>): Promise<T> {
  const hasWindow = typeof window !== "undefined";
  if (hasWindow && count === 0) {
    window.addEventListener("beforeunload", ask);
  }
  count++;
  try {
    return await work();
  } finally {
    count--;
    if (hasWindow && count === 0) {
      window.removeEventListener("beforeunload", ask);
    }
  }
}
