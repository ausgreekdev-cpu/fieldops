import { useEffect, useState, useCallback } from 'react';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { seedDefaultChecklists } from '@/db/seed';
import type { ChecklistTemplate } from '@/types';

export function useChecklists(companyId?: string) {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const db = getRawDb();
      // If companyId given, seed defaults first (offline-first)
      if (companyId) {
        try { await seedDefaultChecklists(companyId); } catch (e) { /* ignore */ }
      }
      const rows = (await db.getAllAsync(
        `SELECT id, company_id as companyId, name, description, fields, is_active as isActive FROM compliance_checklists WHERE is_active=1 ORDER BY name ASC`
      )) as any[];

      const parsed: ChecklistTemplate[] = rows.map(r => ({
        id: r.id,
        companyId: r.companyId,
        name: r.name,
        description: r.description,
        fields: typeof r.fields === 'string' ? JSON.parse(r.fields) : r.fields,
        isActive: !!r.isActive,
      }));
      setTemplates(parsed);

      // Background pull from Supabase if online and companyId available (hydrate)
      if (companyId) {
        try {
          const supabase = getSupabase();
          const { data } = await supabase.from('compliance_checklists').select('*').eq('company_id', companyId).eq('is_active', true);
          if (data && data.length > 0) {
            // Upsert missing into local
            for (const remote of data) {
              const localExists = parsed.find(p => p.id === remote.id);
              if (!localExists) {
                await db.runAsync(`INSERT OR REPLACE INTO compliance_checklists (id, company_id, name, description, fields, is_active, synced) VALUES (?, ?, ?, ?, ?, 1, 1)`, [
                  remote.id, remote.company_id, remote.name, remote.description, JSON.stringify(remote.fields)
                ]);
              }
            }
            // re-read if inserted
            if (data.length !== parsed.length) {
              const refreshed = (await db.getAllAsync(`SELECT id, company_id as companyId, name, description, fields, is_active as isActive FROM compliance_checklists WHERE is_active=1 ORDER BY name ASC`)) as any[];
              setTemplates(refreshed.map(r => ({
                id: r.id, companyId: r.companyId, name: r.name, description: r.description,
                fields: typeof r.fields === 'string' ? JSON.parse(r.fields) : r.fields, isActive: !!r.isActive
              })));
            }
          }
        } catch (e: any) {
          // offline = ignore
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { templates, loading, error, refresh };
}

export function useChecklistSubmissions(jobId: string) {
  const [subs, setSubs] = useState<any[]>([]);
  const refresh = useCallback(async () => {
    try {
      const db = getRawDb();
      const rows = await db.getAllAsync(`SELECT * FROM checklist_submissions WHERE job_id=? ORDER BY created_at DESC`, [jobId]);
      setSubs(rows as any[]);
    } catch { setSubs([]); }
  }, [jobId]);
  useEffect(() => { refresh(); }, [refresh]);
  return { subs, refresh };
}
