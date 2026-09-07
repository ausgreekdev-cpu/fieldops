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

    // Validate amount + currency (Stripe minimum 50 cents, aud only for now)
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt < 50) return new Response(JSON.stringify({ error: 'amount must be integer cents >= 50' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!['aud', 'usd'].includes(currency)) return new Response(JSON.stringify({ error: 'currency must be aud or usd' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = getAdminClient();

    // Ownership + amount check if invoice_id supplied
    let companyId: string | null = null;
    if (invoice_id) {
      const { data: userRow } = await admin.from('users').select('company_id').eq('id', user.id).single();
      companyId = userRow?.company_id ?? null;
      const { data: inv } = await admin.from('invoices').select('company_id, total, invoice_number').eq('id', invoice_id).single();
      if (!inv) return new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (companyId && inv.company_id !== companyId) return new Response(JSON.stringify({ error: 'Invoice not in your company' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      // amount should match invoice total (allow 1 cent rounding)
      const expected = Math.round(Number(inv.total) * 100);
      if (Math.abs(amt - expected) > 1) console.warn('[create-payment-link] amount mismatch', { amt, expected, invoice_id });
      if (!companyId) companyId = inv.company_id;
    } else {
      const { data: userRow } = await admin.from('users').select('company_id').eq('id', user.id).single();
      companyId = userRow?.company_id ?? null;
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    let url: string;

    if (stripeKey) {
      const params = new URLSearchParams({
        'line_items[0][price_data][currency]': currency,
        'line_items[0][price_data][product_data][name]': `Invoice ${invoice_number}`,
        'line_items[0][price_data][unit_amount]': String(amt),
        'line_items[0][quantity]': '1',
      });
      // Attach metadata for webhook correlation (critical)
      if (invoice_id) params.set('metadata[invoice_id]', invoice_id);
      if (companyId) params.set('metadata[company_id]', companyId);
      params.set('metadata[invoice_number]', invoice_number);
      // For checkout.session.completed fallback, also set client_reference_id
      if (invoice_id) params.set('client_reference_id', invoice_id);

      const idempotencyKey = invoice_id ? `invoice_${invoice_id}_${amt}` : `invoice_${invoice_number}_${amt}`;
      const res = await fetch('https://api.stripe.com/v1/payment_links', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': idempotencyKey,
        },
        body: params.toString(),
      });
      if (!res.ok) throw new Error(`Stripe failed: ${res.status} ${(await res.text()).slice(0, 600)}`);
      const json = await res.json() as any;
      url = json.url;
      if (!url) throw new Error('Stripe returned no url');
    } else {
      url = `https://pay.fieldops.example/invoice/${encodeURIComponent(invoice_number)}?amount=${amt}`;
    }

    if (invoice_id) {
      await admin.from('invoices').update({ payment_link: url }).eq('id', invoice_id);
    }

    return new Response(JSON.stringify({ url }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[create-payment-link]', e.message);
    return new Response(JSON.stringify({ error: e.message ?? 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
