# AI Knowledge Base

An AI-powered Q&A app that answers questions from a stored knowledge base first, with Groq LLM as a fallback. Every answer is indexed for future semantic matching using pgvector.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Plain HTML/CSS/JS (`index.html`) |
| API | Vercel Serverless Functions (Node.js) |
| Database | Supabase (PostgreSQL + pgvector) |
| AI / Embeddings | Groq API (`llama-3.3-70b-versatile` + `nomic-embed-text-v1`) |
| Deployment | Vercel |

---

## Project Structure

```
/
├── index.html          ← Full frontend (single file)
├── api/
│   └── ask.js          ← POST /api/ask  (serverless)
├── lib/
│   ├── supabase.js     ← Supabase client + DB helpers
│   └── groq.js         ← Groq embed + chat helpers
├── schema.sql          ← Supabase schema (run once)
├── .env.example        ← Environment variable template
├── vercel.json         ← Vercel routing config
└── README.md
```

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/your-username/your-repo.git
cd your-repo
npm init -y
npm install @supabase/supabase-js
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GROQ_API_KEY=gsk_...
```

> Get Supabase keys: Dashboard → Project Settings → API  
> Get Groq key: https://console.groq.com/keys

### 3. Set up Supabase

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Paste the contents of `schema.sql` and click **Run**

This creates:
- `knowledge_base` — stores authoritative content with vector embeddings
- `intent_groups` — clusters semantically equivalent questions
- `question_history` — every Q&A pair
- `question_variations` — alternative phrasings with embeddings
- `match_knowledge()` RPC — cosine similarity search over KB
- `match_variations()` RPC — cosine similarity search over past questions

> **Note on vector dimensions:** The schema uses `VECTOR(1536)` by default. Groq's `nomic-embed-text-v1` returns 768-dim vectors. Before running the schema, change `VECTOR(1536)` → `VECTOR(768)` in `schema.sql`, or use OpenAI's `text-embedding-3-small` (1536-dim) by swapping the embed call in `lib/groq.js`.

### 4. Seed knowledge

Add rows to `knowledge_base` via the Supabase Table Editor or SQL:

```sql
INSERT INTO knowledge_base (content, metadata)
VALUES (
  'Your authoritative answer content here.',
  '{"topic": "general", "tags": ["example"]}'
);
```

Embeddings are generated at query time via the `/api/ask` route (the first question that matches will trigger embedding + storage).

For bulk ingest, write a one-off script:

```js
// scripts/ingest.js
import { embed } from '../lib/groq.js';
import { supabase } from '../lib/supabase.js';

const docs = [
  { content: 'Fact one...', metadata: { topic: 'intro' } },
  { content: 'Fact two...', metadata: { topic: 'setup' } },
];

for (const doc of docs) {
  const embedding = await embed(doc.content);
  await supabase.from('knowledge_base').insert({ ...doc, embedding });
  console.log('Inserted:', doc.content.slice(0, 50));
}
```

---

## How it works

```
User question
     │
     ▼
Embed question (Groq nomic-embed-text-v1)
     │
     ├─▶ Search question_variations (similarity ≥ 0.88)
     │        └─ Cache hit → return stored answer immediately
     │
     ├─▶ Search knowledge_base (similarity ≥ 0.75)
     │        └─ Match found → synthesize answer with Groq (KB context)
     │                         source: "knowledge_base" 🟢
     │
     └─▶ No match → Groq LLM generates answer
                    source: "ai_generated" 🔵

After response is sent (background):
  1. Generate 5 question variations via Groq
  2. Embed all variations
  3. Create intent group
  4. Save variations + history to Supabase
```

---

## Deploy to Vercel

### Option A — Vercel CLI

```bash
npm i -g vercel
vercel login
vercel --prod
```

When prompted, add environment variables, or set them in **Vercel Dashboard → Project → Settings → Environment Variables**.

### Option B — GitHub integration

1. Push this repo to GitHub
2. Go to https://vercel.com/new
3. Import the repository
4. Add environment variables in the Vercel UI
5. Deploy

Vercel auto-deploys on every `git push`.

---

## Local development

```bash
npm i -g vercel
vercel dev
```

Open http://localhost:3000 — the `vercel dev` command serves `index.html` and runs `api/ask.js` as a local serverless function.

---

## Customisation

| What | Where |
|------|-------|
| Similarity threshold (KB) | `api/ask.js` → `searchKnowledge(queryEmbedding, 0.75)` |
| Similarity threshold (variations cache) | `api/ask.js` → `searchVariations(queryEmbedding, 0.88)` |
| LLM model | `lib/groq.js` → `model: 'llama-3.3-70b-versatile'` |
| Embedding model | `lib/groq.js` → `model: 'nomic-embed-text-v1'` |
| Answer max tokens | `lib/groq.js` → `max_tokens: 512` |
| Number of variations | `lib/groq.js` → `generateVariations()` prompt |

---

## Supabase RLS (Row Level Security)

The API uses the **service role key** (bypasses RLS). For production, consider:

1. Enabling RLS on all tables
2. Adding policies so only authenticated users (or your service role) can read/write
3. Never exposing `SUPABASE_SERVICE_ROLE_KEY` to the browser

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Missing GROQ_API_KEY` | Add to `.env` or Vercel env vars |
| `Knowledge search failed` | Check pgvector extension is enabled; run `CREATE EXTENSION IF NOT EXISTS vector;` |
| Vector dimension mismatch | Match schema `VECTOR(N)` to your embedding model's output dim |
| CORS errors locally | Use `vercel dev` instead of a plain HTTP server |
| 504 timeout on first query | Cold start — increase `maxDuration` in `vercel.json` |
