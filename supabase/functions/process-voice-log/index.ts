// deno-lint-ignore-file no-explicit-any
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { VoiceLogJsonSchema, VOICE_SYSTEM_PROMPT } from '../_shared/schemas.ts';
import { getAdminClient, getUserFromRequest } from '../_shared/supabaseAdmin.ts';

// Edge runtime: Deno (Supabase Functions)
Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    // ── Auth ──
    const user = await getUserFromRequest(req);
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // ── Parse multipart ──
    const form = await req.formData();
    const audio = form.get('audio') as File | null;
    const jobId = form.get('job_id') as string | null;
    if (!audio || !jobId) {
      return new Response(JSON.stringify({ error: 'Missing audio file or job_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (audio.size > 15 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Audio too large (max 15MB)' }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = getAdminClient();

    // Verify job belongs to user's company
    const { data: userRow } = await admin.from('users').select('company_id').eq('id', user.id).single();
    if (!userRow?.company_id) return new Response(JSON.stringify({ error: 'No company linked to user' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: job } = await admin.from('jobs').select('id, company_id').eq('id', jobId).single();
    if (!job || job.company_id !== userRow.company_id) {
      return new Response(JSON.stringify({ error: 'Job not found or access denied' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── 1. Transcribe with Whisper ──
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) throw new Error('OPENAI_API_KEY not configured');
    const whisperForm = new FormData();
    whisperForm.append('file', audio, audio.name || 'audio.m4a');
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('language', 'en');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: whisperForm,
    });
    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      throw new Error(`Whisper failed: ${whisperRes.status} ${err.slice(0, 800)}`);
    }
    const { text: transcript } = (await whisperRes.json()) as { text: string };
    if (!transcript || transcript.trim().length < 2) {
      return new Response(JSON.stringify({ error: 'No speech detected', transcript }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── 2. Structure with LLM (OpenAI primary, Anthropic fallback if configured) ──
    const aiProvider = Deno.env.get('AI_PROVIDER') ?? 'openai';
    let structured: any;

    if (aiProvider === 'anthropic' && Deno.env.get('ANTHROPIC_API_KEY')) {
      structured = await callAnthropic(transcript);
    } else {
      try {
        structured = await callOpenAI(transcript, openAiKey);
      } catch (e) {
        // fallback to anthropic if available
        if (Deno.env.get('ANTHROPIC_API_KEY')) structured = await callAnthropic(transcript);
        else throw e;
      }
    }

    // Validate required fields
    if (!structured.formatted_notes) throw new Error('LLM returned empty formatted_notes');

    const result = {
      transcript,
      formatted_notes: structured.formatted_notes,
      materials: structured.materials ?? [],
      follow_up_task: structured.follow_up_task ?? null,
      confidence: structured.confidence ?? 0.8,
      job_id: jobId,
    };

    // ── 3. Optional: auto-append to job (only if confidence high and user opted via query param) ──
    const autoApply = form.get('auto_apply') === 'true';
    if (autoApply && result.confidence >= 0.7) {
      // Append notes + materials to existing job record
      const { data: existing } = await admin.from('jobs').select('notes, materials').eq('id', jobId).single();
      const existingNotes = (existing?.notes as string) ?? '';
      const existingMaterials = (existing?.materials as any[]) ?? [];
      const newNotes = existingNotes ? `${existingNotes}\n\n${result.formatted_notes}` : result.formatted_notes;
      const mergedMaterials = [...existingMaterials, ...result.materials];
      await admin.from('jobs').update({ notes: newNotes, materials: mergedMaterials }).eq('id', jobId);
    }

    // Audit log
    await admin.from('sync_logs').insert({
      user_id: user.id,
      company_id: userRow.company_id,
      table_name: 'jobs',
      record_id: jobId,
      operation: 'ai_voice',
      payload: result,
      status: 'synced',
    });

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[process-voice-log]', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function callOpenAI(transcript: string, apiKey: string): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: VOICE_SYSTEM_PROMPT + '\nRespond with JSON matching this schema: ' + JSON.stringify(VoiceLogJsonSchema) },
        { role: 'user', content: `Transcript:\n"""${transcript}"""` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat failed: ${res.status} ${(await res.text()).slice(0, 800)}`);
  const json = (await res.json()) as any;
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty OpenAI response');
  return JSON.parse(content);
}

async function callAnthropic(transcript: string): Promise<any> {
  const key = Deno.env.get('ANTHROPIC_API_KEY')!;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      system: VOICE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Transcript:\n"""${transcript}"""\n\nReturn JSON only matching the schema: ${JSON.stringify(VoiceLogJsonSchema)}` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic failed: ${res.status} ${(await res.text()).slice(0, 800)}`);
  const json = (await res.json()) as any;
  const text = json.content?.[0]?.text;
  if (!text) throw new Error('Empty Anthropic response');
  // Claude may wrap in ```json``` — extract
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}
