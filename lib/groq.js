// lib/groq.js
// Thin wrapper around the Groq API (OpenAI-compatible endpoint)

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_EMBED_URL = 'https://api.groq.com/openai/v1/embeddings';

function groqHeaders() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('Missing GROQ_API_KEY environment variable.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

// ---------------------------------------------------------------------------
// Embeddings
// Groq supports nomic-embed-text-v1 (768-dim).
// If you need 1536-dim to match the schema, duplicate the vector or switch to
// OpenAI's text-embedding-3-small. Here we use nomic and adjust schema to 768.
// ---------------------------------------------------------------------------

/**
 * Generate a semantic embedding for a text string.
 * Returns a number[].
 */
export async function embed(text) {
  const res = await fetch(GROQ_EMBED_URL, {
    method: 'POST',
    headers: groqHeaders(),
    body: JSON.stringify({
      model: 'nomic-embed-text-v1',  // 768-dim
      input: text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq embedding failed (${res.status}): ${err}`);
  }

  const json = await res.json();
  return json.data[0].embedding; // number[]
}

// ---------------------------------------------------------------------------
// Chat completion — used for fallback answers and variation generation
// ---------------------------------------------------------------------------

/**
 * Generate an AI answer when the knowledge base has no match.
 * @param {string} question
 * @returns {Promise<string>}
 */
export async function generateAnswer(question) {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: groqHeaders(),
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 512,
      messages: [
        {
          role: 'system',
          content: `You are a helpful, factual assistant for a knowledge base application.
Answer the user's question clearly and concisely.
If you are uncertain, say so — never invent facts.
Keep answers under 200 words unless more detail is truly necessary.`,
        },
        { role: 'user', content: question },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq chat failed (${res.status}): ${err}`);
  }

  const json = await res.json();
  return json.choices[0].message.content.trim();
}

/**
 * Given an original question, generate 3–7 alternative phrasings.
 * Returns string[].
 */
export async function generateVariations(question) {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: groqHeaders(),
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You generate alternative phrasings of questions for a semantic search system.
Return ONLY a JSON array of strings — no markdown, no explanation, no extra keys.
Example output: ["How do I reset my password?","Steps to reset a password","Forgot password help"]`,
        },
        {
          role: 'user',
          content: `Generate 5 alternative ways to ask this question:\n"${question}"`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq variation generation failed (${res.status}): ${err}`);
  }

  const json = await res.json();
  const raw = json.choices[0].message.content.trim();

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 7) : [];
  } catch {
    // Fallback: split on newlines if JSON parsing fails
    return raw
      .split('\n')
      .map((l) => l.replace(/^[-•\d.)\s"]+|[",]+$/g, '').trim())
      .filter(Boolean)
      .slice(0, 7);
  }
}
