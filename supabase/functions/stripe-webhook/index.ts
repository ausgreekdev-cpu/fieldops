// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabaseAdmin.ts';

// Stripe webhook for team tier management + invoice paid sync
// Verify via STRIPE_WEBHOOK_SECRET (stripe.webhooks.constructEvent equivalent manual HMAC)
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const sig = req.headers.get('stripe-signature');
    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const rawBody = await req.text();

    // Optional signature verification — if secret configured, verify HMAC SHA256
    if (secret && sig) {
      const verified = await verifyStripeSignature(rawBody, sig, secret);
      if (!verified) return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const event = JSON.parse(rawBody) as any;
    const admin = getAdminClient();

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
        const status = event.data?.object?.status as string; // active, past_due
        const tier = status === 'active' ? 'team' : 'pro';
        if (customerId) {
          await admin.from('companies').update({ subscription_tier: tier }).eq('stripe_customer_id', customerId);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const customerId = event.data?.object?.customer as string;
        if (customerId) await admin.from('companies').update({ subscription_tier: 'free' }).eq('stripe_customer_id', customerId);
        break;
      }
      default:
        // log unhandled
        console.log('[stripe-webhook] unhandled', event.type);
    }

    return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[stripe-webhook]', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function verifyStripeSignature(payload: string, signature: string, secret: string): Promise<boolean> {
  try {
    // Stripe signature: t=timestamp,v1=hmac
    const parts = Object.fromEntries(signature.split(',').map(p => p.split('=') as [string, string]));
    const t = parts['t'];
    const v1 = parts['v1'];
    if (!t || !v1) return false;
    const signedPayload = `${t}.${payload}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === v1;
  } catch { return false; }
}
