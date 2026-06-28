import { getStore } from '@netlify/blobs';

export default async function handler() {
  try {
    const store = getStore('dashboard');
    const data = await store.get('latest', { type: 'json' });

    if (!data) {
      return new Response(
        JSON.stringify({ error: 'No data collected yet. Wait for the scheduled collect to run.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('[data]', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
