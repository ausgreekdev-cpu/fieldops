// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabaseAdmin.ts';
import { verifyStripeSignature, amountMatchesPaid } from '../_shared/stripeVerify.ts';

// Stripe webhook — hardened HMAC, fail-closed, multi-v1, timestamp tolerance, idempotency
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const sig = req.headers.get('stripe-signature');
    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const rawBody = await req.text();

    // Fail-closed: secret must be configured, signature required and must verify
    if (!secret) {
      return new Response(JSON.stringify({ error: 'SECRET_NOT_CONFIGURED', hint: 'run: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!sig) return new Response(JSON.stringify({ error: 'Missing stripe-signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const verified = await verifyStripeSignature(rawBody, sig, secret);
    if (!verified) return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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
        const obj = event.data?.object;
        const invoiceId = obj?.metadata?.invoice_id;
        if (invoiceId) {
          const { data: inv } = await admin.from('invoices').select('job_id, total, company_id').eq('id', invoiceId).single();
          if (inv) {
            // Defense in depth: only mark paid when the paid amount matches the invoice
            // (checkout.session.amount_total / payment_intent.amount, both in cents)
            const paidCents = obj?.amount_total ?? obj?.amount;
            if (amountMatchesPaid(paidCents, Number(inv.total))) {
              await admin.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', invoiceId);
              if (inv.job_id) await admin.from('jobs').update({ status: 'invoiced' }).eq('id', inv.job_id);
            } else {
              const expectedCents = Math.round(Number(inv.total) * 100);
              console.warn('[stripe-webhook] amount mismatch — not marking paid', { invoiceId, paidCents, expectedCents });
              await admin.from('sync_logs').insert({
                company_id: inv.company_id,
                table_name: 'invoices',
                record_id: invoiceId,
                operation: 'update',
                payload: { stripe_event: event.id, mismatch: true, paidCents, expectedCents },
                status: 'synced',
              });
            }
          }
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

