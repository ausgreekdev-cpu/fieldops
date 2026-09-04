import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from './SyncManager';

// Typed local-first mutation helpers — all go through SyncManager.enqueue

export async function createJob(input: {
  companyId: string;
  customerName: string;
  address: string;
  title: string;
  customerPhone?: string;
  lat?: number;
  lng?: number;
  scheduledAt?: string;
}) {
  const mgr = SyncManager.getInstance(getSupabase());
  return mgr.upsertJob({
    company_id: input.companyId,
    customer_name: input.customerName,
    address: input.address,
    title: input.title,
    customer_phone: input.customerPhone,
    lat: input.lat,
    lng: input.lng,
    scheduled_at: input.scheduledAt,
    status: 'scheduled',
  });
}

export async function updateJobStatus(id: string, status: 'scheduled' | 'in_progress' | 'completed' | 'invoiced') {
  const db = getRawDb();
  const now = new Date().toISOString();
  await db.runAsync(`UPDATE jobs SET status=?, updated_at=?, synced=0 WHERE id=?`, [status, now, id]);
  const mgr = SyncManager.getInstance(getSupabase());
  const row = (await db.getFirstAsync(`SELECT * FROM jobs WHERE id=?`, [id])) as any;
  if (row) await mgr.enqueue('jobs', id, 'update', { ...row, status, updated_at: now });
}

export async function appendVoiceLog(jobId: string, voiceOutput: { formatted_notes: string; materials: unknown[]; follow_up_task: unknown }) {
  const db = getRawDb();
  const row = (await db.getFirstAsync(`SELECT notes, materials FROM jobs WHERE id=?`, [jobId])) as any;
  const existingNotes = row?.notes ?? '';
  const newNotes = existingNotes ? `${existingNotes}\n\n${voiceOutput.formatted_notes}` : voiceOutput.formatted_notes;
  const existingMaterials = row?.materials ? JSON.parse(row.materials) : [];
  const mergedMaterials = [...existingMaterials, ...(voiceOutput.materials as any[])];
  const now = new Date().toISOString();
  await db.runAsync(`UPDATE jobs SET notes=?, materials=?, updated_at=?, synced=0 WHERE id=?`, [
    newNotes,
    JSON.stringify(mergedMaterials),
    now,
    jobId,
  ]);
  const mgr = SyncManager.getInstance(getSupabase());
  await mgr.enqueue('jobs', jobId, 'update', { id: jobId, notes: newNotes, materials: mergedMaterials, updated_at: now });
  return { notes: newNotes, materials: mergedMaterials, followUp: voiceOutput.follow_up_task };
}
