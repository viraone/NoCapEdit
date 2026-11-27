/**
 * "Style it" for the Story window (desktop app): DeepSeek looks at one frame of the video and the
 * words, picks a look for the title, and the title on the open project changes. Asking again keeps
 * the same picture and says which looks were already tried; Plain puts the title back as it was.
 */
import { create } from "zustand";
import { openVideo } from "@/lib/phone/highlightCover";
import { useEditor } from "@/store/editorStore";
import { askWords, lookFrom, lookOf, triedList, type Look } from "./aiStyleLook";
import type { StorySlot } from "./phoneBridge";
import type { TextOverlay } from "@/lib/models/project";

/** One run of "Style it" on one title. */
export interface AiStyleSession {
  overlayId: string;
  projectId: string;
  words: string;
  slot: StorySlot;
  /** Base64 JPEG of one moment of the video, kept so Again asks about the same picture. */
  frame: string | null;
  /** The title's style before the first suggestion, for Plain. */
  before: Look;
  /** Looks already suggested, as "name: font colour on background". */
  tried: string[];
  state: "busy" | "done" | "error";
  name: string;
  why: string;
  error: string;
}

interface AiStyleState {
  session: AiStyleSession | null;
  start(ask: { overlayId: string; words: string; slot: StorySlot; video: Blob }): Promise<void>;
  /** Asks for another look, on the same picture. */
  again(): Promise<void>;
  /** Puts the title's style back to what it was before the first suggestion. */
  plain(): void;
}

/** Goes up with every ask; an answer for an older number is dropped. */
let turn = 0;

/** The shell's error with its IPC wrapper taken off, or a fallback. */
function messageOf(e: unknown): string {
  const text = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "";
  return text || "The style could not be made.";
}

export const useAiStyle = create<AiStyleState>((set, get) => {
  /** Sends the ask and puts the answer on the title, unless a newer ask has started. */
  async function request(mine: number): Promise<void> {
    const session = get().session;
    if (!session?.frame) return;
    const api = window.nocapDesktop?.caption?.style;
    if (!api) throw new Error("DeepSeek is not set up on this Mac.");
    const reply = await api({ words: session.words, slot: session.slot, frame: session.frame, previous: session.tried });
    if (mine !== turn) return;
    const current = get().session;
    if (!current) return;
    const project = useEditor.getState().project;
    if (project?.id === current.projectId) {
      useEditor.getState().update((draft) => {
        const overlay = draft.overlays.find((o) => o.id === current.overlayId);
        if (overlay && overlay.kind === "text") Object.assign(overlay, lookFrom(reply));
      });
    }
    set({ session: { ...current, state: "done", name: reply.name, why: reply.why, tried: triedList(current.tried, reply) } });
  }

  function fail(mine: number, e: unknown): void {
    if (mine !== turn) return;
    set((s) => (s.session ? { session: { ...s.session, state: "error", error: messageOf(e) } } : {}));
  }

  return {
    session: null,

    async start(ask) {
      const project = useEditor.getState().project;
      if (!project) return;
      const target = project.overlays.find((o): o is TextOverlay => o.id === ask.overlayId && o.kind === "text");
      if (!target) return;

      const old = get().session;
      const same = old !== null && old.overlayId === ask.overlayId && old.projectId === project.id;
      const mine = ++turn;
      const next: AiStyleSession = {
        overlayId: ask.overlayId,
        projectId: project.id,
        words: ask.words,
        slot: ask.slot,
        frame: same ? old.frame : null,
        before: same ? old.before : lookOf(target),
        tried: same ? old.tried : [],
        state: "busy",
        name: "",
        why: "",
        error: "",
      };
      set({ session: next });

      try {
        let frame = next.frame;
        if (!frame) {
          const source = await openVideo(ask.video);
          try {
            if (mine !== turn) return;
            const frames = await source.frames();
            frame = frames[Math.floor(frames.length / 2)]?.jpeg ?? null;
          } finally {
            source.close();
          }
          if (mine !== turn) return;
          if (!frame) throw new Error("No picture could be taken from the video.");
          set((s) => (s.session ? { session: { ...s.session, frame } } : {}));
        }
        if (mine !== turn) return;
        await request(mine);
      } catch (e) {
        fail(mine, e);
      }
    },

    async again() {
      const session = get().session;
      if (!session || session.state === "busy" || !session.frame) return;
      const mine = ++turn;
      // Ask about the words as they are now, if the title is still on the same project.
      const project = useEditor.getState().project;
      const overlay = project?.id === session.projectId ? project.overlays.find((o) => o.id === session.overlayId) : undefined;
      const words = askWords(overlay?.kind === "text" ? overlay.text : null, session.words);
      set({ session: { ...session, state: "busy", error: "", words } });
      try {
        await request(mine);
      } catch (e) {
        fail(mine, e);
      }
    },

    plain() {
      const session = get().session;
      if (!session) return;
      const mine = ++turn;
      const project = useEditor.getState().project;
      if (project?.id === session.projectId) {
        useEditor.getState().update((draft) => {
          const overlay = draft.overlays.find((o) => o.id === session.overlayId);
          if (overlay && overlay.kind === "text") Object.assign(overlay, lookOf(session.before));
        });
      }
      if (mine !== turn) return;
      set({ session: { ...session, state: "done", name: "Plain", why: "", error: "" } });
    },
  };
});
