// lib/groq.js
// Groq for chat completions, Hugging Face for embeddings

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const HF_EMBED_URL = 'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2';

function groqHeaders() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('Missing GROQ_API_KEY environment variable.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

function hfHeaders() {
  const key = process.env.HF_API_KEY;
  if (!key) throw new Error('Missing HF_API_KEY environment variable.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

// ---------------------------------------------------------------------------
// Embeddings via Hugging Face
// all-MiniLM-L6-v2 = 384-dim, free, no rate limits for small usage
// ---------------------------------------------------------------------------

export async function embed(text) {
  const res = await fetch(HF_EMBED_URL, {
    method: 'POST',
    headers: hfHeaders(),
    body: JSON.stringify({ inputs: text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HF embedding failed (${res.status}): ${err}`);
  }

  const json = await res.json();

  // HF returns either a flat array or nested array depending on model
  const embedding = Array.isArray(json[0]) ? json[0] : json;
  return embedding;
}

// ---------------------------------------------------------------------------
// Chat completion via Groq
// ---------------------------------------------------------------------------

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
    return raw
      .split('\n')
      .map((l) => l.replace(/^[-•\d.)\s"]+|[",]+$/g, '').trim())
      .filter(Boolean)
      .slice(0, 7);
  }
}
