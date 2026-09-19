import * as React from 'react';
import { View, Text, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { getSupabase } from '@/lib/supabase';

type Mode = 'email' | 'phone';

export default function LoginScreen() {
  const [mode, setMode] = React.useState<Mode>('email');
  const [value, setValue] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function sendOtp() {
    const v = value.trim();
    if (!v) { Alert.alert('Enter a value', mode === 'email' ? 'Enter your email address.' : 'Use +61 format e.g. +61412345678'); return; }
    setLoading(true);
    try {
      const supabase = getSupabase();
      if (mode === 'email') {
        const { error } = await supabase.auth.signInWithOtp({ email: v, options: { shouldCreateUser: true } });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({ phone: v, options: { shouldCreateUser: true } });
        if (error) throw error;
      }
      router.push({ pathname: '/(auth)/verify-otp', params: { mode, value: v } });
    } catch (e: any) {
      Alert.alert('Failed', e.message);
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>FieldOps</Text>
        <Text style={styles.sub}>Email code login — no SMS provider needed, works on web + mobile. Offline after first sign-in.</Text>

        <View style={styles.tabs}>
          <Button title="Email" size="sm" variant={mode === 'email' ? 'primary' : 'secondary'} onPress={() => { setMode('email'); setValue(''); }} />
          <Button title="Phone" size="sm" variant={mode === 'phone' ? 'primary' : 'secondary'} onPress={() => { setMode('phone'); setValue(''); }} />
        </View>

        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={mode === 'email' ? 'you@company.com' : '+61 4XX XXX XXX'}
          keyboardType={mode === 'email' ? 'email-address' : 'phone-pad'}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          placeholderTextColor="#94A3B8"
        />
        <Button title={loading ? 'Sending…' : 'Send Code'} onPress={sendOtp} loading={loading} />
        <Text style={styles.foot}>
          {mode === 'email'
            ? 'We email you a 6-digit code. Works out of the box — no SMS/Twilio setup.'
            : 'Phone OTP needs a SMS provider (e.g. Twilio) configured in Supabase Auth.'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FFF', padding: 24 },
  title: { fontSize: 32, fontWeight: '900', color: '#0F172A', letterSpacing: -1 },
  sub: { color: '#64748B', fontSize: 14, marginBottom: 12, lineHeight: 20 },
  tabs: { flexDirection: 'row', gap: 10 },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 16, height: 56, fontSize: 16, color: '#0F172A', backgroundColor: '#F8FAFC' },
  foot: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 17 },
});