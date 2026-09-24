import { Suspense } from "react";
import { EditorPage } from "@/components/editor/EditorPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-neutral-500">Loading editor…</div>}>
      <EditorPage />
    </Suspense>
  );
}
