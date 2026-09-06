import type { UserRole } from '@/hooks/useCurrentUser';

export function canEditTemplates(role: UserRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function canDeleteJob(role: UserRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function canInvite(role: UserRole | null, targetRole: 'technician' | 'admin'): boolean {
  if (!role) return false;
  if (role === 'owner') return true; // can invite anyone
  if (role === 'admin') return targetRole === 'technician'; // admin only techs
  return false; // technician cannot invite
}

export function canEditJob(role: UserRole | null): boolean {
  // all roles can edit job details, but delete is gated
  return !!role;
}

export function canViewInvoices(role: UserRole | null): boolean {
  return !!role; // all can view, but maybe technician read-only
}

export function canManageCompany(role: UserRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function roleLabel(role: UserRole | null): string {
  if (!role) return 'Unknown';
  return role.charAt(0).toUpperCase() + role.slice(1);
}
