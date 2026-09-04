import * as React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Button } from './Button';
import { getOfferings, purchasePackage, restorePurchases, checkEntitlement } from '@/lib/revenuecat';

interface Props {
  visible: boolean;
  onClose: () => void;
  onProGranted?: () => void;
  feature?: string; // e.g. "AI Voice Logs"
}

export function Paywall({ visible, onClose, onProGranted, feature }: Props) {
  const [offerings, setOfferings] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      getOfferings().then(setOfferings).catch(() => {});
      // If already entitled, close
      checkEntitlement('pro').then(has => { if (has) { onProGranted?.(); onClose(); } });
    }
  }, [visible]);

  async function handlePurchase() {
    const pkg = offerings?.current?.availablePackages?.[0];
    if (!pkg) { Alert.alert('No offerings', 'Configure RevenueCat offerings in dashboard'); return; }
    setLoading(true);
    try {
      const { customerInfo } = await purchasePackage(pkg);
      if (customerInfo.entitlements.active['pro']) {
        Alert.alert('Pro unlocked ✓', 'Thanks for supporting FieldOps!');
        onProGranted?.();
        onClose();
      }
    } catch (e: any) {
      if (!e.userCancelled) Alert.alert('Purchase failed', e.message);
    } finally { setLoading(false); }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const info = await restorePurchases();
      if ((info as any).entitlements?.active?.['pro']) {
        Alert.alert('Restored ✓', 'Pro access restored');
        onProGranted?.();
        onClose();
      } else {
        Alert.alert('No purchases', 'No active Pro subscription found');
      }
    } catch (e: any) { Alert.alert('Restore failed', e.message); }
    finally { setRestoring(false); }
  }

  const pkg = offerings?.current?.availablePackages?.[0];
  const price = pkg?.product?.priceString ?? '$9.99/mo';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable onPress={onClose} style={styles.close}><Text style={styles.closeText}>✕</Text></Pressable>
        <Text style={styles.title}>Unlock FieldOps Pro</Text>
        {feature ? <Text style={styles.feature}>For: {feature}</Text> : null}
        <Text style={styles.sub}>Offline-first jobs, unlimited AI logs, branded PDFs & payment links. 7-day free trial.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pro — Everything for crews</Text>
          <Text style={styles.bullet}>• Unlimited Voice-to-Job & Receipt AI</Text>
          <Text style={styles.bullet}>• Custom safety checklist templates</Text>
          <Text style={styles.bullet}>• Branded invoices + Stripe pay links</Text>
          <Text style={styles.bullet}>• 30-day offline history</Text>
          <Text style={styles.price}>{price}</Text>
          <Text style={styles.priceSub}>Billed monthly, cancel anytime</Text>
        </View>

        {loading ? <ActivityIndicator /> : <Button title={`Start Trial — ${price}`} onPress={handlePurchase} />}

        <Pressable onPress={handleRestore} disabled={restoring} style={styles.restore}>
          <Text style={styles.restoreText}>{restoring ? 'Restoring…' : 'Restore Purchases'}</Text>
        </Pressable>

        <Text style={styles.terms}>Free tier: 3 jobs, 5 AI logs/mo. Paywall respects offline — entitlement cached locally via RevenueCat.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FFF', padding: 24, paddingTop: 48, gap: 16 },
  close: { position: 'absolute', top: 16, right: 16, padding: 8 },
  closeText: { fontSize: 20, color: '#64748B' },
  title: { fontSize: 24, fontWeight: '900', color: '#0F172A', textAlign: 'center' },
  feature: { textAlign: 'center', color: '#2563EB', fontWeight: '700' },
  sub: { color: '#64748B', textAlign: 'center', lineHeight: 18 },
  card: { backgroundColor: '#F8FAFC', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 6 },
  cardTitle: { fontWeight: '800', color: '#0F172A' },
  bullet: { color: '#334155', fontSize: 13 },
  price: { fontSize: 20, fontWeight: '900', color: '#0F172A', marginTop: 8, textAlign: 'center' },
  priceSub: { color: '#94A3B8', fontSize: 11, textAlign: 'center' },
  restore: { alignItems: 'center', padding: 12 },
  restoreText: { color: '#2563EB', fontWeight: '700' },
  terms: { color: '#94A3B8', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
