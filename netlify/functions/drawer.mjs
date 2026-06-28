import { createClient } from '@supabase/supabase-js';

export default async function handler(req) {
  const execId = new URL(req.url).searchParams.get('id');
  if (!execId) {
    return new Response(JSON.stringify({ error: 'Missing id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(url, key);

  const [{ data: exec }, { data: agents }, { data: httpReqs }] = await Promise.all([
    sb.from('execution_log').select('*').eq('execution_id', execId).single(),
    sb.from('agent_call_log').select('*').eq('execution_id', execId).order('started_at'),
    sb.from('http_request_log').select('*').eq('execution_id', execId).order('started_at'),
  ]);

  return new Response(JSON.stringify({ exec, agents: agents ?? [], httpReqs: httpReqs ?? [] }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
