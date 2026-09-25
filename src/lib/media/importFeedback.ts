/** One line per file that could not be imported: "name: reason". */
export function importErrorText(failures: { name: string; reason: string }[]): string | null {
  return failures.length ? failures.map((f) => `${f.name}: ${f.reason}`).join("\n") : null;
}
