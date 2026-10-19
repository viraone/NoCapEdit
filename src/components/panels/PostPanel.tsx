"use client";
import { useMemo, useRef, useState } from "react";
import { Copy, Shuffle } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { buildRickshawPost, formatShowDate, nextFriday, parseDateInput, parseHandles, pickHashtags, toDateInput } from "@/lib/ai/rickshawPost";
import { PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Input, textareaClass } from "@/components/ui/Field";
import { cx } from "@/lib/utils/cx";

/** The weekly Instagram caption for the Rickshaw Read the Room Comedy Show: type two handles, copy the post. */
export function PostPanel() {
  const [headliner, setHeadliner] = useState("");
  const [features, setFeatures] = useState("");
  const [date, setDate] = useState(() => toDateInput(nextFriday()));
  const [hashtags, setHashtags] = useState(() => pickHashtags());
  /** The caption after the person typed in it; any change to the fields above starts it over. */
  const [edited, setEdited] = useState<string | null>(null);

  const picked = parseDateInput(date);
  const built = useMemo(
    () =>
      buildRickshawPost({
        headliner: parseHandles(headliner)[0] ?? "",
        features: parseHandles(features),
        date: picked ? formatShowDate(picked) : "",
        hashtags,
      }),
    [headliner, features, picked, hashtags],
  );
  const text = edited ?? built;
  const notFriday = !!picked && picked.getDay() !== 5;

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setEdited(null);
  };

  const box = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    const notice = useEditor.getState().setNotice;
    try {
      await navigator.clipboard.writeText(text);
      return notice("Copied the post.");
    } catch {
      /* no clipboard permission: select the text and use the older copy command */
    }
    box.current?.select();
    notice(document.execCommand("copy") ? "Copied the post." : "Could not copy. The text is selected: press Cmd/Ctrl+C.");
  };

  return (
    <>
      <PanelHeader title="Post" description="The weekly Instagram post for the Rickshaw Read the Room Comedy Show. Type the two Instagram accounts, then copy it." />
      <PanelSection title="This week">
        <Field label="Headliner" hint="Instagram account, with or without the @.">
          <Input value={headliner} onChange={(e) => change(setHeadliner)(e.target.value)} placeholder="@danhurwitzcomedy" autoCapitalize="off" autoCorrect="off" spellCheck={false} data-post-headliner />
        </Field>
        <Field label="Feature" hint="More than one? Separate them with a space or comma.">
          <Input value={features} onChange={(e) => change(setFeatures)(e.target.value)} placeholder="@allegrakeys" autoCapitalize="off" autoCorrect="off" spellCheck={false} data-post-feature />
        </Field>
        <Field label="Friday">
          <Input type="date" value={date} onChange={(e) => change(setDate)(e.target.value)} data-post-date />
        </Field>
        {notFriday && <p className="rf-read-note">That day is not a Friday, but the post will still say &quot;Friday&quot;.</p>}
      </PanelSection>

      <PanelSection
        title="Your post"
        right={
          <Button variant="ghost" size="xs" onClick={() => change(setHashtags)(pickHashtags())} aria-label="Shuffle the hashtags">
            <Shuffle size={11} /> Shuffle hashtags
          </Button>
        }
      >
        <textarea ref={box} className={cx(textareaClass, "min-h-72")} value={text} onChange={(e) => setEdited(e.target.value)} aria-label="Instagram post" data-post-text />
        <Button variant="primary" size="md" className="w-full" onClick={() => void copy()} data-post-copy>
          <Copy size={13} /> Copy post
        </Button>
        {edited !== null && (
          <Button variant="ghost" size="xs" onClick={() => setEdited(null)}>
            Undo my changes
          </Button>
        )}
      </PanelSection>
    </>
  );
}
