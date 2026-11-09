/** Shapes shared by the chat agent: the DeepSeek tool-calling messages, the tools, and what a tool reports back. */

/** One tool in the OpenAI-compatible function-calling format DeepSeek takes. */
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** A tool call the model asked for. `arguments` is the raw JSON text the model wrote. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** A message in a tool-calling conversation, in the shape the API takes. */
export type ApiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** What running one tool reports: `message` goes back to the model, `label` is the short line shown to the user. */
export interface ToolResult {
  ok: boolean;
  message: string;
  label?: string;
}

/** One edit the agent made (or tried), as shown under the assistant's reply. */
export interface AgentAction {
  label: string;
  ok: boolean;
}
