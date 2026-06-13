// api/ask.js
// Vercel serverless function — handles POST /api/ask
//
// Flow:
//  1. Embed the question
//  2. Search question_variations for a cached intent → reuse stored answer
//  3. Search knowledge_base for relevant content → synthesize answer
//  4. Fallback to Groq LLM if no KB match
//  5. Background: generate variations, create intent group, persist everything

import { embed, generateAnswer, generateVariations } from '../lib/groq.js';
import {
  searchKnowledge,
  searchVariations,
  saveHistory,
  createIntentGroup,
  saveVariations,
  supabase,
} from '../lib/supabase.js';

// CORS helper — allow same-origin and localhost in dev
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);

  // Handle pre-flight
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Parse body ────────────────────────────────────────────────────────────
  let question, userId;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    question = (body?.question ?? '').trim();
    userId = body?.userId ?? null;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }

  if (!question) return res.status(400).json({ error: 'question is required.' });
  if (question.length > 1000) return res.status(400).json({ error: 'Question too long (max 1000 chars).' });

  try {
    // ── Step 1: Embed the question ──────────────────────────────────────────
    const queryEmbedding = await embed(question);

    // ── Step 2: Check cached intent variations ──────────────────────────────
    const varMatches = await searchVariations(queryEmbedding, 0.88);
    if (varMatches.length > 0) {
      const topVar = varMatches[0];

      // Fetch the most recent answer for this intent group
      const { data: historyRow } = await supabase
        .from('question_history')
        .select('answer, source')
        .eq('intent_group_id', topVar.intent_group_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (historyRow) {
        // Cache hit — return immediately, log in background
        res.status(200).json({
          answer: historyRow.answer,
          source: historyRow.source,
          cached: true,
        });

        // Background: save this query to history too
        saveHistory({
          userId,
          question,
          answer: historyRow.answer,
          source: historyRow.source,
          intentGroupId: topVar.intent_group_id,
        }).catch(console.error);

        return;
      }
    }

    // ── Step 3: Search knowledge base ───────────────────────────────────────
    const kbMatches = await searchKnowledge(queryEmbedding, 0.75);

    let answer;
    let source;

    if (kbMatches.length > 0) {
      // Build context from top matches
      const context = kbMatches
        .map((m, i) => `[${i + 1}] ${m.content}`)
        .join('\n\n');

      // Ask Groq to synthesize an answer from the KB context
      const prompt = `Use ONLY the following knowledge base excerpts to answer the question.
Do not add any information not present in the excerpts.
If the excerpts don't contain enough information, say so clearly.

KNOWLEDGE BASE:
${context}

QUESTION: ${question}

Answer concisely and factually:`;

      answer = await generateAnswer(prompt);
      source = 'knowledge_base';
    } else {
      // ── Step 4: Groq fallback ─────────────────────────────────────────────
      answer = await generateAnswer(question);
      source = 'ai_generated';
    }

    // ── Respond immediately ─────────────────────────────────────────────────
    res.status(200).json({ answer, source, cached: false });

    // ── Step 5: Background persistence ─────────────────────────────────────
    // (runs after response is sent — Vercel keeps the function alive briefly)
    backgroundPersist({ question, answer, source, userId, queryEmbedding }).catch(
      (err) => console.error('Background persist error:', err)
    );
  } catch (err) {
    console.error('Handler error:', err);
    // Avoid leaking internal details
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// ── Background job ────────────────────────────────────────────────────────────
async function backgroundPersist({ question, answer, source, userId, queryEmbedding }) {
  try {
    // Generate question variations
    const variationTexts = await generateVariations(question);
    const allTexts = [question, ...variationTexts];

    // Embed all variation texts (parallel)
    const embeddings = await Promise.all(allTexts.map((t) => embed(t)));

    // Create an intent group labelled with the original question (truncated)
    const label = question.length > 120 ? question.slice(0, 120) + '…' : question;
    const intentGroupId = await createIntentGroup(label);

    // Save variations with embeddings
    const variations = allTexts.map((text, i) => ({ text, embedding: embeddings[i] }));
    await saveVariations(intentGroupId, variations);

    // Save to question history
    await saveHistory({ userId, question, answer, source, intentGroupId });
  } catch (err) {
    console.error('Background persist failed:', err.message);
  }
}
