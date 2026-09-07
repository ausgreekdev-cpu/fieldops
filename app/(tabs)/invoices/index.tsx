import * as React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert, Linking, Pressable } from 'react-native';
import { Button } from '@/components/ui/Button';
import { useInvoices } from '@/features/invoices/useInvoices';
import { shareInvoicePdf, createStripePaymentLinkStub } from '@/features/invoices/generateInvoice';
import { exportInvoicesCsv } from '@/lib/csv';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';

export default function InvoicesScreen() {
  const [companyId, setCompanyId] = React.useState<string | undefined>(undefined);
  const { invoices, loading, refresh } = useInvoices(companyId);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.from('users').select('company_id').eq('id', user.id).single();
          if (data?.company_id) setCompanyId(data.company_id);
        }
        if (!companyId) {
          const db = getRawDb();
          const row = (await db.getFirstAsync(`SELECT company_id as cid FROM invoices LIMIT 1`)) as any;
          if (row?.cid) setCompanyId(row.cid);
        }
      } catch {}
    })();
  }, []);

  async function handleShare(item: any) {
    const localPath = item.pdf_path?.startsWith('file:') || item.pdf_path?.startsWith('/') ? item.pdf_path : null;
    // If pdf_path is storage path, try local file first
    try {
      const db = getRawDb();
      const row = (await db.getFirstAsync(`SELECT pdf_path FROM invoices WHERE id=?`, [item.id])) as any;
      const uri = row?.pdf_path;
      if (uri && uri.startsWith('file')) {
        await shareInvoicePdf(uri, item.invoice_number);
      } else {
        // fallback: open storage URL
        const supabase = getSupabase();
        const { data } = supabase.storage.from('invoices').getPublicUrl(item.pdf_path ?? '');
        if (data?.publicUrl) Linking.openURL(data.publicUrl);
        else Alert.alert('No PDF', 'PDF not yet synced — check offline file');
      }
    } catch (e: any) { Alert.alert('Share failed', e.message); }
  }

  async function handlePaymentLink(item: any) {
    if (item.payment_link) {
      Linking.openURL(item.payment_link);
      return;
    }
    setBusyId(item.id);
    try {
      const url = await createStripePaymentLinkStub(item.total, item.invoice_number, item.id);
      // Save locally + queue update (with invoice_id for webhook correlation)
      const db = getRawDb();
      await db.runAsync(`UPDATE invoices SET payment_link=?, synced=0 WHERE id=?`, [url, item.id]);
      const { SyncManager } = await import('@/sync/SyncManager');
      const mgr = SyncManager.getInstance(getSupabase());
      await mgr.enqueue('invoices' as any, item.id, 'update', { id: item.id, payment_link: url });
      Alert.alert('Payment link ready', url);
      Linking.openURL(url);
      refresh();
    } catch (e: any) { Alert.alert('Link failed', e.message); }
    finally { setBusyId(null); }
  }

  async function handleWhatsApp(item: any) {
    const msg = `Hi, here is your invoice ${item.invoice_number} for $${Number(item.total).toFixed(2)}. ${item.payment_link ? `Pay: ${item.payment_link}` : ''} — Thanks from FieldOps!`;
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    Linking.openURL(url);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Invoices</Text>
        <Text style={styles.sub}>One-tap branded PDF — offline-first, share via SMS/WhatsApp/Email</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Button title="↻ Refresh" size="sm" variant="secondary" onPress={refresh} />
          <Button title="Export CSV" size="sm" variant="secondary" onPress={() => exportInvoicesCsv(invoices as any)} />
        </View>
      </View>

      <FlatList
        data={invoices}
        keyExtractor={i => i.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No invoices yet</Text><Text style={styles.emptySub}>Complete a job → Generate Invoice (works offline)</Text></View>}
        renderItem={({ item }) => {
          const items = typeof item.line_items === 'string' ? JSON.parse(item.line_items) : item.line_items;
          const isBusy = busyId === item.id;
          return (
            <Pressable style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.invNumber}>{item.invoice_number}</Text>
                <View style={[styles.badge, item.status === 'paid' ? styles.badgePaid : styles.badgeDraft]}><Text style={styles.badgeText}>{item.status.toUpperCase()}</Text></View>
              </View>
              <Text style={styles.meta}>{new Date(item.created_at).toLocaleDateString()} • {items?.length ?? 0} items</Text>
              <Text style={styles.total}>${Number(item.total).toFixed(2)} <Text style={styles.subtotal}>(sub ${Number(item.subtotal).toFixed(2)} + GST ${Number(item.tax).toFixed(2)})</Text></Text>
              {item.pdf_path ? <Text style={styles.pdfPath} numberOfLines={1}>{item.pdf_path}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button title="Share PDF" size="sm" onPress={() => handleShare(item)} />
                <Button title={item.payment_link ? 'Pay Link' : 'Create Pay Link'} size="sm" variant="secondary" onPress={() => handlePaymentLink(item)} loading={isBusy} />
                <Button title="WhatsApp" size="sm" variant="ghost" onPress={() => handleWhatsApp(item)} />
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { padding: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  sub: { color: '#64748B', fontSize: 13, marginTop: 4 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 4 },
  invNumber: { fontWeight: '900', color: '#0F172A', fontSize: 16 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeDraft: { backgroundColor: '#F1F5F9' },
  badgePaid: { backgroundColor: '#DCFCE7' },
  badgeText: { fontWeight: '800', fontSize: 10, color: '#334155' },
  meta: { color: '#64748B', fontSize: 11 },
  total: { fontWeight: '800', color: '#0F172A', fontSize: 18, marginTop: 4 },
  subtotal: { fontWeight: '400', color: '#64748B', fontSize: 11 },
  pdfPath: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  empty: { marginTop: 32, backgroundColor: '#FFF', borderRadius: 16, padding: 24, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  emptyText: { fontWeight: '800', color: '#0F172A' },
  emptySub: { color: '#94A3B8', fontSize: 12, textAlign: 'center' },
});
