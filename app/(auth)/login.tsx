import * as React from 'react';
import { View, Text, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { getSupabase } from '@/lib/supabase';

export default function LoginScreen() {
  const [phone, setPhone] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function sendOtp() {
    if (!phone) { Alert.alert('Enter phone', 'Use +61 format e.g. +61412345678'); return; }
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
      if (error) throw error;
      router.push({ pathname: '/(auth)/verify-otp', params: { phone } });
    } catch (e: any) {
      Alert.alert('Failed', e.message);
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
      <Text style={styles.title}>FieldOps</Text>
      <Text style={styles.sub}>Phone OTP login — works offline after first sign-in</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="+61 4XX XXX XXX"
        keyboardType="phone-pad"
        autoCapitalize="none"
        style={styles.input}
        placeholderTextColor="#94A3B8"
      />
      <Button title="Send Code" onPress={sendOtp} loading={loading} />
      <View style={{ height: 12 }} />
      <Button title="Magic Link (Email)" variant="secondary" onPress={() => Alert.alert('Email OTP', 'Wire email input similarly with supabase.auth.signInWithOtp({ email })')} />
      <Text style={styles.foot}>No spam. 60-second onboarding after login.</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FFF', padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 32, fontWeight: '900', color: '#0F172A', letterSpacing: -1 },
  sub: { color: '#64748B', fontSize: 14, marginBottom: 12 },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 16, height: 56, fontSize: 16, color: '#0F172A', backgroundColor: '#F8FAFC' },
  foot: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 16 },
});
