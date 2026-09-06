import * as React from 'react';
import { getSupabase } from '@/lib/supabase';
import { getRawDb } from '@/db/client';

export type UserRole = 'owner' | 'admin' | 'technician';

export interface CurrentUser {
  id: string;
  companyId: string | null;
  role: UserRole | null;
  displayName: string | null;
  phone: string | null;
}

export function useCurrentUser() {
  const [user, setUser] = React.useState<CurrentUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data } = await supabase.from('users').select('id, company_id, role, display_name, phone').eq('id', authUser.id).single();
        if (data) {
          setUser({ id: data.id, companyId: data.company_id, role: data.role as UserRole, displayName: data.display_name, phone: data.phone });
          return;
        }
      }
      // fallback local
      const db = getRawDb();
      const row = (await db.getFirstAsync(`SELECT id, company_id as companyId, role, display_name as displayName, phone FROM users LIMIT 1`)) as any;
      if (row) setUser({ id: row.id, companyId: row.companyId, role: row.role as UserRole, displayName: row.displayName, phone: row.phone });
      else setUser(null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  return { user, loading, refresh, role: user?.role ?? null, companyId: user?.companyId ?? null };
}
