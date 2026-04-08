// DECOY (D4): this is a CORRECT server-side OpenAI usage pattern.
// The scanner must NOT flag this file for C3 or C4. Specifically:
//   - The key is read from process.env.OPENAI_API_KEY (server-only).
//   - This file lives at app/**/route.ts (classified as server-only).
//   - No NEXT_PUBLIC_ prefix anywhere.
//   - No literal key string.

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST(request: Request) {
  const { prompt } = (await request.json()) as { prompt?: string };
  if (!prompt) {
    return new Response("prompt required", { status: 400 });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Write a short profile bio." },
      { role: "user", content: prompt }
    ]
  });

  return Response.json({
    bio: completion.choices[0]?.message?.content ?? ""
  });
}
