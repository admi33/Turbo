// lib/supabase.js
// Supabase client — used by all API routes
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role for server-side ops

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Knowledge Base helpers
// ---------------------------------------------------------------------------

/**
 * Semantic search over knowledge_base using a precomputed embedding.
 * @param {number[]} embedding  – 1536-dim vector
 * @param {number}   threshold  – cosine similarity floor (0-1)
 * @returns {Promise<Array>}
 */
export async function searchKnowledge(embedding, threshold = 0.75) {
  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: 5,
  });
  if (error) throw new Error(`Knowledge search failed: ${error.message}`);
  return data ?? [];
}

/**
 * Semantic search over question_variations to find a cached intent.
 * @param {number[]} embedding
 * @param {number}   threshold
 */
export async function searchVariations(embedding, threshold = 0.80) {
  const { data, error } = await supabase.rpc('match_variations', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: 3,
  });
  if (error) throw new Error(`Variation search failed: ${error.message}`);
  return data ?? [];
}

/**
 * Persist a Q&A pair to question_history.
 */
export async function saveHistory({ userId, question, answer, source, intentGroupId }) {
  const { error } = await supabase.from('question_history').insert({
    user_id: userId ?? null,
    question,
    answer,
    source,
    intent_group_id: intentGroupId ?? null,
  });
  if (error) console.error('Failed to save history:', error.message);
}

/**
 * Create a new intent group and return its id.
 */
export async function createIntentGroup(label) {
  const { data, error } = await supabase
    .from('intent_groups')
    .insert({ label })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create intent group: ${error.message}`);
  return data.id;
}

/**
 * Bulk-insert question variations (with embeddings) for a given intent group.
 * @param {string}   intentGroupId
 * @param {Array<{text: string, embedding: number[]}>} variations
 */
export async function saveVariations(intentGroupId, variations) {
  const rows = variations.map(({ text, embedding }) => ({
    intent_group_id: intentGroupId,
    variation_text: text,
    embedding,
  }));
  const { error } = await supabase.from('question_variations').insert(rows);
  if (error) console.error('Failed to save variations:', error.message);
}
