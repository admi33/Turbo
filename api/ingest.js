// api/ingest.js
// POST /api/ingest  — adds a new entry to the knowledge base
//
// Body: { content: string, topic?: string, tags?: string[] }
// Returns: { id, content, metadata }

import { embed } from '../lib/groq.js';
import { supabase } from '../lib/supabase.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let content, topic, tags;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    content = (body?.content ?? '').trim();
    topic   = (body?.topic ?? '').trim() || 'general';
    tags    = Array.isArray(body?.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : [];
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }

  if (!content) return res.status(400).json({ error: 'content is required.' });
  if (content.length < 10) return res.status(400).json({ error: 'Content too short (min 10 chars).' });
  if (content.length > 8000) return res.status(400).json({ error: 'Content too long (max 8000 chars).' });

  try {
    // Generate embedding for the content
    const embedding = await embed(content);

    const metadata = { topic, tags };

    const { data, error } = await supabase
      .from('knowledge_base')
      .insert({ content, embedding, metadata })
      .select('id, content, metadata, created_at')
      .single();

    if (error) throw new Error(`Database insert failed: ${error.message}`);

    return res.status(201).json({ success: true, entry: data });
  } catch (err) {
    console.error('Ingest error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save entry.' });
  }
}
