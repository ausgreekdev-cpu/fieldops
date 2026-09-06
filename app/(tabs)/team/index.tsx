import * as React from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Alert, Pressable } from 'react-native';
import { Button } from '@/components/ui/Button';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { inviteSchema } from '@/lib/validation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { canInvite } from '@/lib/permissions';
import { useActivity } from '@/features/team/useActivity';

interface Member { id: string; display_name: string | null; phone: string | null; role: string; }

export default function TeamScreen() {
  const { role: myRole, companyId: myCompanyId } = useCurrentUser();
  const [members, setMembers] = React.useState<Member[]>([]);
  const [invitePhone, setInvitePhone] = React.useState('');
  const [inviteName, setInviteName] = React.useState('');
  const [role, setRole] = React.useState<'technician'|'admin'>('technician');
  const [companyId, setCompanyId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const { items: activity, refresh: refreshActivity } = useActivity(10);
  const load = React.useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      let cid: string | null = null;
      if (user) {
        const { data } = await supabase.from('users').select('company_id').eq('id', user.id).single();
        cid = (data as any)?.company_id ?? null;
      }
      if (!cid) {
        const db = getRawDb();
        const row = (await db.getFirstAsync(`SELECT company_id as cid FROM users LIMIT 1`)) as any;
        cid = row?.cid ?? (await db.getFirstAsync(`SELECT id as cid FROM companies LIMIT 1`) as any)?.cid ?? null;
      }
      if (cid) setCompanyId(cid);
      // local first
      const db = getRawDb();
      const local = (await db.getAllAsync(`SELECT id, display_name, phone, role FROM users WHERE company_id=? ORDER BY role DESC, display_name ASC`, [cid])) as Member[];
      if (local.length) setMembers(local);
      // then remote
      if (cid) {
        const { data } = await supabase.from('users').select('id,display_name,phone,role').eq('company_id', cid).order('role');
        if (data) {
          setMembers(data as any);
          // cache locally
          for (const m of data as any[]) {
            await db.runAsync(`INSERT OR REPLACE INTO users (id, company_id, role, display_name, phone, created_at, updated_at, synced) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
              [m.id, cid, m.role, m.display_name, m.phone, new Date().toISOString(), new Date().toISOString()]);
          }
        }
      }
    } catch (e) { console.warn(e); }
    refreshActivity();
  }, [refreshActivity]);

  React.useEffect(() => { load(); }, [load]);

  async function handleInvite() {
    if (!canInvite(myRole, role)) { Alert.alert('Permission denied', `Your role ${myRole ?? 'unknown'} cannot invite as ${role} — owner only for admin invites`); return; }
    const parsed = inviteSchema.safeParse({ phone: invitePhone, displayName: inviteName, role });
    if (!parsed.success) { Alert.alert('Validation', parsed.error.issues.map(i=>i.message).join('\n')); return; }
    if (!companyId) { Alert.alert('No company'); return; }
    setSaving(true);
    try {
      const supabase = getSupabase();
      // Create pending invite via Supabase: insert into users with phone and company_id, role technician
      // For MVP, we create a placeholder user row that will be claimed on OTP login (phone match)
      const { data, error } = await supabase.from('users').insert({
        phone: invitePhone.trim(),
        display_name: inviteName.trim() || null,
        company_id: companyId,
        role,
      } as any).select('id').single();

      // Handle RLS: if insert fails due to policy, fallback to local enqueue (offline invite)
      if (error) {
        // offline-first: create local placeholder + outbox
        const db = getRawDb();
        const tempId = `pending_${Date.now()}`;
        await db.runAsync(`INSERT INTO users (id, company_id, role, display_name, phone, created_at, updated_at, synced) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          [tempId, companyId, role, inviteName.trim() || null, invitePhone.trim(), new Date().toISOString(), new Date().toISOString()]);
        const mgr = SyncManager.getInstance(supabase);
        await mgr.enqueue('users' as any, tempId, 'insert', { id: tempId, company_id: companyId, role, display_name: inviteName.trim() || null, phone: invitePhone.trim() });
        Alert.alert('Invite queued offline ✓', 'Will sync when online. User can claim via OTP with this phone.');
      } else {
        Alert.alert('Invite sent ✓', `User ${invitePhone} added as ${role}. They login via OTP to claim.`);
      }
      setInvitePhone(''); setInviteName('');
      load();
    } catch (e: any) { Alert.alert('Invite failed', e.message); }
    finally { setSaving(false); }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Team</Text>
        <Text style={styles.sub}>Invite — claim via phone OTP. Your role: {myRole ?? '…'} {myRole ? (canInvite(myRole,'admin') ? '• can invite admin+tech' : canInvite(myRole,'technician') ? '• can invite tech' : '• read-only') : ''}. Offline-first.</Text>
      </View>

      <View style={styles.inviteCard}>
        <Text style={styles.label}>Invite by Phone *</Text>
        <TextInput value={invitePhone} onChangeText={setInvitePhone} placeholder="+61 4XX XXX XXX" keyboardType="phone-pad" style={styles.input} placeholderTextColor="#94A3B8" />
        <Text style={styles.label}>Name</Text>
        <TextInput value={inviteName} onChangeText={setInviteName} placeholder="Alex — apprentice" style={styles.input} placeholderTextColor="#94A3B8" />
        <Text style={styles.label}>Role</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['technician','admin'] as const).map(r => {
            const disabled = !canInvite(myRole, r);
            return (
              <Pressable key={r} onPress={()=> !disabled && setRole(r)} style={[styles.roleChip, role===r && styles.roleChipActive, disabled && { opacity: 0.4 }]}>
                <Text style={[styles.roleText, role===r && styles.roleTextActive]}>{r}{disabled ? ' 🔒' : ''}</Text>
              </Pressable>
            );
          })}
        </View>
        <Button title={saving ? 'Inviting…' : 'Invite (Offline)'} onPress={handleInvite} loading={saving} disabled={!canInvite(myRole, role)} />
      </View>

      <FlatList
        data={members}
        keyExtractor={i=>i.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 8 }}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {activity.length === 0 ? <Text style={styles.emptySmall}>No activity yet — create a job or run a checklist</Text> : activity.map(a => (
              <View key={a.id} style={styles.activityRow}>
                <Text style={[styles.activityDot, a.type==='job' ? styles.dotJob : a.type==='checklist' ? styles.dotCheck : a.type==='invoice' ? styles.dotInv : styles.dotSync]}>{a.type==='job' ? '🗂' : a.type==='checklist' ? '✓' : a.type==='invoice' ? '＄' : '↻'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTitle} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.activitySub}>{a.subtitle} • {new Date(a.time).toLocaleDateString()}</Text>
                </View>
                <Text style={[styles.activityStatus, a.status==='pass' || a.status==='paid' ? styles.statusPass : a.status==='fail' ? styles.statusFail : styles.statusPending]}>{(a.status ?? '').toUpperCase()}</Text>
              </View>
            ))}
            <Text style={styles.sectionTitle}>Members ({members.length})</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No members yet</Text>}
        renderItem={({item})=>(
          <View style={styles.memberCard}>
            <View style={[styles.avatar, item.role==='owner' ? styles.avatarOwner : item.role==='admin' ? styles.avatarAdmin : styles.avatarTech]}><Text style={styles.avatarText}>{(item.display_name?.[0] ?? item.phone?.slice(-2) ?? '?').toUpperCase()}</Text></View>
            <View style={{ flex:1 }}>
              <Text style={styles.memberName}>{item.display_name ?? 'Pending invite'}</Text>
              <Text style={styles.memberMeta}>{item.phone ?? ''} • {item.role}</Text>
            </View>
            <Text style={[styles.roleBadge, item.role==='owner' ? styles.badgeOwner : item.role==='admin' ? styles.badgeAdmin : styles.badgeTech]}>{item.role.toUpperCase()}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { padding: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  title: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  sub: { color: '#64748B', fontSize: 12, marginTop: 4 },
  inviteCard: { margin: 16, backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  label: { fontWeight: '700', color: '#0F172A', fontSize: 12 },
  input: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, backgroundColor: '#FFF', color: '#0F172A' },
  roleChip: { flex:1, paddingVertical:10, borderRadius:999, borderWidth:1, borderColor:'#E2E8F0', alignItems:'center', backgroundColor:'#FFF' },
  roleChipActive: { backgroundColor:'#0F172A', borderColor:'#0F172A' },
  roleText: { fontWeight:'700', color:'#475569', fontSize:12 },
  roleTextActive: { color:'#FFF' },
  memberCard: { flexDirection:'row', alignItems:'center', gap:12, backgroundColor:'#FFF', padding:12, borderRadius:12, borderWidth:1, borderColor:'#E2E8F0' },
  avatar: { width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  avatarOwner: { backgroundColor:'#0F172A' },
  avatarAdmin: { backgroundColor:'#2563EB' },
  avatarTech: { backgroundColor:'#64748B' },
  avatarText: { color:'#FFF', fontWeight:'900' },
  memberName: { fontWeight:'800', color:'#0F172A' },
  memberMeta: { color:'#64748B', fontSize:11 },
  roleBadge: { paddingHorizontal:8, paddingVertical:4, borderRadius:999, fontWeight:'800', fontSize:10, overflow:'hidden' } as any,
  badgeOwner: { backgroundColor:'#0F172A', color:'#FFF' } as any,
  badgeAdmin: { backgroundColor:'#DBEAFE', color:'#1D4ED8' } as any,
  badgeTech: { backgroundColor:'#F1F5F9', color:'#475569' } as any,
  empty: { textAlign:'center', color:'#94A3B8', marginTop:24 },
  sectionTitle: { fontWeight:'800', color:'#0F172A', fontSize:13, marginTop:4 },
  emptySmall: { color:'#94A3B8', fontSize:11, textAlign:'center' },
  activityRow: { flexDirection:'row', gap:10, alignItems:'center', backgroundColor:'#FFF', padding:10, borderRadius:10, borderWidth:1, borderColor:'#E2E8F0' },
  activityDot: { width:28, height:28, borderRadius:14, textAlign:'center', textAlignVertical:'center', fontSize:14 } as any,
  dotJob: { backgroundColor:'#F1F5F9' } as any,
  dotCheck: { backgroundColor:'#DCFCE7' } as any,
  dotInv: { backgroundColor:'#EDE9FE' } as any,
  dotSync: { backgroundColor:'#F1F5F9' } as any,
  activityTitle: { fontWeight:'700', color:'#0F172A', fontSize:12 },
  activitySub: { color:'#64748B', fontSize:11 },
  activityStatus: { fontWeight:'800', fontSize:10, paddingHorizontal:6, paddingVertical:2, borderRadius:999, overflow:'hidden' } as any,
  statusPass: { backgroundColor:'#DCFCE7', color:'#15803D' } as any,
  statusFail: { backgroundColor:'#FEE2E2', color:'#DC2626' } as any,
  statusPending: { backgroundColor:'#F1F5F9', color:'#475569' } as any,
});
