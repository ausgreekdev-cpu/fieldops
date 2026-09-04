// deno-lint-ignore-file no-explicit-any
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getAdminClient, getUserFromRequest } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const user = await getUserFromRequest(req);
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { amount, currency = 'aud', invoice_number, invoice_id } = await req.json();
    if (!amount || !invoice_number) return new Response(JSON.stringify({ error: 'Missing amount or invoice_number' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    let url: string;

    if (stripeKey) {
      // Create Stripe Payment Link via API (price creation inline)
      // Stripe API: POST https://api.stripe.com/v1/payment_links with price_data
      const params = new URLSearchParams({
        'line_items[0][price_data][currency]': currency,
        'line_items[0][price_data][product_data][name]': `Invoice ${invoice_number}`,
        'line_items[0][price_data][unit_amount]': String(amount),
        'line_items[0][quantity]': '1',
      });
      const res = await fetch('https://api.stripe.com/v1/payment_links', {
        method: 'POST',
        headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) throw new Error(`Stripe failed: ${res.status} ${(await res.text()).slice(0, 600)}`);
      const json = await res.json() as any;
      url = json.url;
      if (!url) throw new Error('Stripe returned no url');
    } else {
      // Stub for dev/offline — deterministic placeholder
      url = `https://pay.fieldops.example/invoice/${encodeURIComponent(invoice_number)}?amount=${amount}`;
    }

    // Persist to invoice if invoice_id given
    if (invoice_id) {
      const admin = getAdminClient();
      await admin.from('invoices').update({ payment_link: url }).eq('id', invoice_id);
    }

    return new Response(JSON.stringify({ url }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[create-payment-link]', e);
    return new Response(JSON.stringify({ error: e.message ?? 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
