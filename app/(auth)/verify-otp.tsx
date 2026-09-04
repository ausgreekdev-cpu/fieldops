import * as React from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { getSupabase } from '@/lib/supabase';

export default function VerifyOtpScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function verify() {
    if (!code || !phone) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.verifyOtp({ phone: phone as string, token: code, type: 'sms' });
      if (error) throw error;
      // Check if onboarding needed
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from('users').select('company_id').eq('id', user!.id).single();
      if (!profile?.company_id) router.replace('/(auth)/onboarding');
      else router.replace('/(tabs)/jobs');
    } catch (e: any) {
      Alert.alert('Invalid code', e.message);
    } finally { setLoading(false); }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Enter code</Text>
      <Text style={styles.sub}>Sent to {phone}</Text>
      <TextInput value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" maxLength={6} style={styles.input} placeholderTextColor="#94A3B8" />
      <Button title="Verify & Continue" onPress={verify} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FFF', padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 24, fontWeight: '800', color: '#0F172A' },
  sub: { color: '#64748B' },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 16, height: 56, fontSize: 20, letterSpacing: 8, textAlign: 'center', backgroundColor: '#F8FAFC' },
});
