// deno-lint-ignore-file no-explicit-any
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { ReceiptJsonSchema, RECEIPT_SYSTEM_PROMPT } from '../_shared/schemas.ts';
import { getAdminClient, getUserFromRequest } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const form = await req.formData();
    const image = form.get('image') as File | null;
    const jobId = form.get('job_id') as string | null;
    if (!image || !jobId) {
      return new Response(JSON.stringify({ error: 'Missing image or job_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (image.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Image too large (max 10MB)' }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = getAdminClient();
    const { data: userRow } = await admin.from('users').select('company_id').eq('id', user.id).single();
    if (!userRow?.company_id) return new Response(JSON.stringify({ error: 'No company linked' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: job } = await admin.from('jobs').select('id, company_id').eq('id', jobId).single();
    if (!job || job.company_id !== userRow.company_id) {
      return new Response(JSON.stringify({ error: 'Job not found or access denied' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Read image as base64 for Vision model
    const bytes = new Uint8Array(await image.arrayBuffer());
    let b64 = '';
    // chunked b64 for large images
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    b64 = btoa(b64);
    const mime = image.type || 'image/jpeg';

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) throw new Error('OPENAI_API_KEY not configured');

    // Call GPT-4o Vision with structured JSON
    const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: RECEIPT_SYSTEM_PROMPT + '\nRespond with JSON matching: ' + JSON.stringify(ReceiptJsonSchema) },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Parse this receipt / equipment plate image into structured JSON.' },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } },
            ],
          },
        ],
        max_tokens: 1200,
      }),
    });
    if (!visionRes.ok) throw new Error(`Vision failed: ${visionRes.status} ${(await visionRes.text()).slice(0, 800)}`);
    const vJson = (await visionRes.json()) as any;
    const content = vJson.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty vision response');
    const parsed = JSON.parse(content);

    const result = {
      vendor: parsed.vendor ?? 'Unknown',
      date: parsed.date ?? new Date().toISOString().slice(0, 10),
      line_items: parsed.line_items ?? [],
      total: parsed.total ?? 0,
      tax: parsed.tax ?? null,
      currency: parsed.currency ?? 'AUD',
      job_id: jobId,
    };

    // Auto-attach to job materials if requested
    const autoApply = form.get('auto_apply') === 'true';
    if (autoApply && result.line_items.length > 0) {
      const { data: existing } = await admin.from('jobs').select('materials').eq('id', jobId).single();
      const mats = (existing?.materials as any[]) ?? [];
      const newMats = result.line_items.map((li: any) => ({ name: li.desc, qty: li.qty ?? 1, unit_price: li.price }));
      await admin.from('jobs').update({ materials: [...mats, ...newMats] }).eq('id', jobId);
    }

    await admin.from('sync_logs').insert({
      user_id: user.id,
      company_id: userRow.company_id,
      table_name: 'jobs',
      record_id: jobId,
      operation: 'ai_receipt',
      payload: result,
      status: 'synced',
    });

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[parse-receipt]', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
