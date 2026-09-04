import * as React from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Audio } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { getSupabase } from '@/lib/supabase';
import { appendVoiceLog } from '@/sync/mutations';

interface Props {
  jobId: string;
  companyId: string;
  onResult?: (r: any) => void;
}

export function VoiceButton({ jobId, onResult }: Props) {
  const [recording, setRecording] = React.useState<Audio.Recording | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string>('');

  async function startRecording() {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone needed', 'Enable mic permission to use Voice-to-Job.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      setStatus('Listening… hold and speak');
    } catch (e: any) {
      Alert.alert('Recording failed', e.message);
    }
  }

  async function stopAndProcess() {
    if (!recording) return;
    setBusy(true);
    setStatus('Processing…');
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) throw new Error('No audio file');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      // Upload to Edge Function
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const form = new FormData();
      // RN FormData file append
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) throw new Error('Audio file missing');

      // Use fetch with blob — expo FileSystem URI fetch works via supabase functions invoke with FormData polyfill
      // We build manual fetch to Edge Function
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const audioBlob = { uri, name: 'voice.m4a', type: 'audio/m4a' } as any;
      const fd = new FormData();
      fd.append('audio', audioBlob);
      fd.append('job_id', jobId);

      const res = await fetch(`${supabaseUrl}/functions/v1/process-voice-log`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd as any,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Voice failed: ${res.status}`);

      // Local-first append to job
      await appendVoiceLog(jobId, json);
      setStatus('Done ✓');
      onResult?.(json);
      Alert.alert('Job log updated', json.formatted_notes);
    } catch (e: any) {
      setStatus('');
      Alert.alert('Voice log failed', e.message);
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(''), 2000);
    }
  }

  const isHolding = !!recording;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPressIn={startRecording}
        onPressOut={stopAndProcess}
        disabled={busy}
        style={({ pressed }) => [styles.btn, { backgroundColor: isHolding ? '#DC2626' : pressed ? '#1E293B' : '#0F172A', opacity: busy ? 0.6 : 1 }]}
      >
        {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>{isHolding ? '● Recording — release to send' : '🎙 Hold to Dictate Job Log'}</Text>}
      </Pressable>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <Text style={styles.hint}>One press — auto-creates notes, materials & follow-up task</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 8 },
  btn: { height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { color: '#FFF', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  status: { textAlign: 'center', color: '#334155', fontWeight: '600', fontSize: 13 },
  hint: { textAlign: 'center', color: '#94A3B8', fontSize: 12 },
});
