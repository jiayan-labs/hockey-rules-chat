import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      instructions:
        "You are a helpful field hockey rules assistant. Answer clearly and simply. If unsure, say so.",
      input: question,
    });

    res.status(200).json({
      answer: response.output_text,
    });
  } catch (error) {
    console.error("OpenAI error:", error);
    res.status(500).json({
      error: "Something went wrong calling OpenAI",
    });
  }
}