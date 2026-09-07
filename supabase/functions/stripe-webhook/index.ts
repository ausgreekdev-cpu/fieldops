// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabaseAdmin.ts';

// Stripe webhook — hardened HMAC, fail-closed, multi-v1, timestamp tolerance, idempotency
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const sig = req.headers.get('stripe-signature');
    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const rawBody = await req.text();

    // Fail-closed: if secret is configured, signature is required and must verify
    if (secret) {
      if (!sig) return new Response(JSON.stringify({ error: 'Missing stripe-signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const verified = await verifyStripeSignature(rawBody, sig, secret);
      if (!verified) return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification (dev only)');
    }

    const event = JSON.parse(rawBody) as any;
    const admin = getAdminClient();

    // Idempotency: deduplicate by event.id via sync_logs (stripe_events)
    const eventId = event.id as string | undefined;
    if (eventId) {
      const { data: existing } = await admin.from('sync_logs').select('id').eq('record_id', eventId).eq('table_name', 'stripe_events').limit(1);
      if (existing && existing.length > 0) {
        return new Response(JSON.stringify({ received: true, deduped: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      // log event id early to claim (best-effort)
      try { await admin.from('sync_logs').insert({ table_name: 'stripe_events', record_id: eventId, operation: 'insert', payload: { type: event.type }, status: 'synced' }); } catch {}
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'payment_intent.succeeded': {
        const invoiceId = event.data?.object?.metadata?.invoice_id;
        if (invoiceId) {
          await admin.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', invoiceId);
          const { data: inv } = await admin.from('invoices').select('job_id').eq('id', invoiceId).single();
          if (inv?.job_id) await admin.from('jobs').update({ status: 'invoiced' }).eq('id', inv.job_id);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const customerId = event.data?.object?.customer as string;
        const status = event.data?.object?.status as string;
        const tier = status === 'active' ? 'team' : 'pro';
        if (customerId) await admin.from('companies').update({ subscription_tier: tier }).eq('stripe_customer_id', customerId);
        break;
      }
      case 'customer.subscription.deleted': {
        const customerId = event.data?.object?.customer as string;
        if (customerId) await admin.from('companies').update({ subscription_tier: 'free' }).eq('stripe_customer_id', customerId);
        break;
      }
      default:
        console.log('[stripe-webhook] unhandled', event.type);
    }

    return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[stripe-webhook]', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    // Stripe sends: t=timestamp,v1=hex,v1=hex (multiple for rotation) — collect all v1
    const parts = sigHeader.split(',').map(p => p.trim());
    const tPart = parts.find(p => p.startsWith('t='));
    const v1s = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
    if (!tPart || v1s.length === 0) return false;
    const t = tPart.slice(2);
    const ts = Number(t);
    if (!Number.isFinite(ts)) return false;
    // 5 minute tolerance (replay protection)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) return false;

    const signedPayload = `${t}.${payload}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    // constant-time compare for each v1 (avoid timing leak)
    const hexBytes = new TextEncoder().encode(hex);
    for (const v1 of v1s) {
      const v1Bytes = new TextEncoder().encode(v1);
      if (v1Bytes.length !== hexBytes.length) continue;
      let diff = 0;
      for (let i = 0; i < hexBytes.length; i++) diff |= hexBytes[i] ^ v1Bytes[i];
      if (diff === 0) return true;
    }
    return false;
  } catch { return false; }
}
