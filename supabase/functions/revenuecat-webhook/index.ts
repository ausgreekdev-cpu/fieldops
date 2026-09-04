// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabaseAdmin.ts';

// RevenueCat webhook for App Store / Play entitlements → companies.subscription_tier
// Configure in RevenueCat Dashboard: Integrations → Webhooks → URL: https://<project>.supabase.co/functions/v1/revenuecat-webhook
// Header: Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET> (if set)
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
    if (secret) {
      const auth = req.headers.get('authorization');
      if (auth !== `Bearer ${secret}`) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json() as any;
    const event = body.event as any; // RevenueCat event envelope
    const appUserId: string | undefined = event?.app_user_id ?? body.app_user_id;
    const type: string = event?.type ?? body.type; // e.g. INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION
    const entitlementId: string | undefined = event?.entitlement_ids?.[0] ?? body.entitlement_ids?.[0];
    const periodType: string | undefined = event?.period_type;

    console.log('[revenuecat-webhook]', type, appUserId, entitlementId);

    if (!appUserId) return new Response(JSON.stringify({ received: true, note: 'no app_user_id' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = getAdminClient();
    // app_user_id is Supabase user id (we configure Purchases.configure with appUserID = supabase user id)
    const { data: userRow } = await admin.from('users').select('company_id').eq('id', appUserId).single();
    if (!userRow?.company_id) return new Response(JSON.stringify({ received: true, note: 'no company' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let tier: 'free' | 'pro' | 'team' = 'free';
    if (['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'BILLING_ISSUE', 'PRODUCT_CHANGE'].includes(type)) {
      tier = entitlementId === 'team' ? 'team' : 'pro';
    } else if (['CANCELLATION', 'EXPIRATION', 'REFUND'].includes(type)) {
      tier = 'free';
    } else {
      // for TEST / non-subscription events keep current
      return new Response(JSON.stringify({ received: true, type }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await admin.from('companies').update({ subscription_tier: tier }).eq('id', userRow.company_id);

    // Also log to sync_logs for audit
    await admin.from('sync_logs').insert({
      company_id: userRow.company_id,
      table_name: 'companies',
      record_id: userRow.company_id,
      operation: 'update',
      payload: { subscription_tier: tier, source: 'revenuecat', type, entitlementId, periodType },
      status: 'synced',
    });

    return new Response(JSON.stringify({ received: true, tier }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[revenuecat-webhook]', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
