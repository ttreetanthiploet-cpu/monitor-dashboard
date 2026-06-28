import { createClient } from '@supabase/supabase-js';
import { getStore } from '@netlify/blobs';

const MAIN_WF_ID = 'CQCLdVdNwrmvI5do';
const COLLECT_DAYS = 90;
const LOG_LIMIT = 50;

async function fetchAll(queryFn) {
  const PAGE = 1000;
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFn().range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

async function fetchFlagsInChunks(sb, execIdArray) {
  if (!execIdArray.length) return [];
  const CHUNK = 100;
  const results = [];
  for (let i = 0; i < execIdArray.length; i += CHUNK) {
    const { data } = await sb
      .from('workflow_agent_flags')
      .select('*')
      .in('execution_id', execIdArray.slice(i, i + CHUNK));
    if (data) results.push(...data);
  }
  return results;
}

export default async function handler() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');

  const sb = createClient(url, key);

  const since = new Date();
  since.setDate(since.getDate() - COLLECT_DAYS);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  console.log(`[collect] Fetching from ${sinceIso}`);

  const [executionLog, agentCallLog, httpErrors] = await Promise.all([
    fetchAll(() =>
      sb.from('execution_log')
        .select('*')
        .gte('started_at', sinceIso)
        .order('started_at', { ascending: false })
    ),
    fetchAll(() =>
      sb.from('agent_call_log')
        .select('*')
        .gte('started_at', sinceIso)
        .order('started_at', { ascending: false })
    ),
    fetchAll(() =>
      sb.from('http_request_log')
        .select('execution_id,node_name,workflow_name,url,response_status,error_message,started_at,success')
        .eq('success', false)
        .gte('started_at', sinceIso)
        .order('started_at', { ascending: false })
    ),
  ]);

  const execIds = [...new Set(executionLog.map(r => r.execution_id))];
  const flagRows = await fetchFlagsInChunks(sb, execIds);

  // Last 50 agent_call_log rows regardless of period (for the Logs tab)
  const { data: logRows } = await sb
    .from('agent_call_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(LOG_LIMIT);

  const payload = {
    collectedAt: new Date().toISOString(),
    sinceIso,
    mainWfId: MAIN_WF_ID,
    executionLog,
    agentCallLog,
    httpErrors,
    flagRows,
    logRows: logRows ?? [],
  };

  const store = getStore('dashboard');
  await store.setJSON('latest', payload);

  console.log(`[collect] Done — executions: ${executionLog.length}, agent calls: ${agentCallLog.length}, flags: ${flagRows.length}, logRows: ${logRows?.length}`);
}

export const config = {
  schedule: '*/10 * * * *',
};
