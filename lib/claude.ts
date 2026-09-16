// lib/claude.ts
// Wrapper around the Anthropic API for the listing-extraction feature
// (app/api/extract-listing/route.ts) — replaces the local Ollama path
// (lib/ollama.ts, kept for reference/offline use) after gpt-oss:20b proved
// too slow (~60-90s) and llama3.2:3b proved unreliable on Canadian address
// formats ("203 College St 1706" parsed with the unit number as the street
// number, repeatably). This is a one-shot, low-volume call per listing paste
// — not a hot loop — so model accuracy matters far more than shaving cents.
//
// Reads ANTHROPIC_API_KEY from the environment (.env.local, gitignored).

import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "./logger";

// Sonnet 5 ($2/$10 per MTok) rather than Opus 5 ($5/$25) — a deliberate
// cost decision, taken with the eval result in hand rather than instead of
// it: Sonnet scores 15/18 where Opus scores 18/18.
//
// The failure that matters is the condominium legal description. Given
// "Unit 1706, Level 17, TSCC 2510", Opus puts 1706 in condo_apt_unit_no and
// flags condo_unit_number as not stated; Sonnet writes 1706 into
// condo_unit_number, which is the LEGAL unit per the registered plan and
// frequently not the number on the door. On Form 101 that misdescribes the
// property being purchased. It is a quiet failure — the PDF generates and
// looks right.
//
// So: review the condo fields on a purchase deal before sending it out.
// CLAUDE_MODEL overrides this per-run; `CLAUDE_MODEL=claude-opus-5 npx tsx
// scripts/extraction_eval.ts` re-scores the old model any time.
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// Forced tool use for extraction: returns already-parsed structured JSON
// (Anthropic validates it against input_schema before we ever see it) instead
// of asking the model to emit JSON in prose and regex-matching it out — more
// robust, and lets us express "flag this instead of guessing" as a real
// second output channel rather than overloading a single value with null.
//
// userContent accepts either plain text (pasted listing text) or a content
// block array — the latter is how app/api/extract-listing/route.ts sends an
// uploaded PDF natively (as a `document` block) instead of pre-flattening it
// to text via pypdf. Native PDF input preserves table/column layout (e.g.
// REALM's two-column property-info table) that flattened text loses, which
// was causing sparser/blank fields to get missed.
export async function claudeExtractWithTool<T>(
  systemPrompt: string,
  userContent: string | Anthropic.MessageParam["content"],
  toolName: string,
  toolDescription: string,
  inputSchema: Anthropic.Tool["input_schema"]
): Promise<T> {
  // Prompt caching. Input is ~97% of what an extraction costs: the system
  // prompt and the tool schema come to ~4,100 tokens and are byte-identical
  // for every call within a form set, while the listing text the realtor
  // pastes is a couple of hundred. Without a breakpoint every call re-bills
  // that whole prefix at full rate.
  //
  // The breakpoint goes on the system block because the request renders
  // tools -> system -> messages, so one marker there covers both stable
  // parts. Everything volatile (the pasted text, the answers already on
  // file) is in `messages`, after it — which is what keeps the prefix
  // byte-stable and the cache warm.
  //
  // Measured on this workload: $0.0235 -> $0.0055 per call in steady state,
  // 4.3x. The first call after a gap costs ~22% more (the write is billed at
  // 1.25x), so it pays for itself on the second call and every one after.
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8192,
    output_config: { effort: "medium" },
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    tools: [{ name: toolName, description: toolDescription, input_schema: inputSchema }],
    tool_choice: { type: "tool", name: toolName },
    messages: [{ role: "user", content: userContent }],
  });

  logUsage({ route: "claude-extract", model: MODEL, tool: toolName }, response.usage);

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("Claude did not call the extraction tool");
  }
  return toolUse.input as T;
}
