import type { ChatMessage } from "./deepseekChat";

/** The conversation, kept for this page visit so closing and reopening the chat panel does not lose it. */
let kept: ChatMessage[] = [];

export function readKept(): ChatMessage[] {
  return kept;
}

export function writeKept(messages: ChatMessage[]): void {
  kept = messages;
}
