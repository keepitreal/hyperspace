import Anthropic from "@anthropic-ai/sdk";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import type { CoinSnapshot } from "./snapshot.js";

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 4000;

export interface AnalysisResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function getAnalysis(snapshot: CoinSnapshot): Promise<AnalysisResult> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it in your shell or .env before running analyst.",
    );
  }

  const client = new Anthropic({ apiKey });
  const userPrompt = buildUserPrompt(snapshot);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  if (text.length === 0) {
    throw new Error(`Anthropic returned no text content (stop_reason=${response.stop_reason})`);
  }

  return {
    text,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
