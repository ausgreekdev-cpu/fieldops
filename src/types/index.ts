export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'invoiced';

export interface Job {
  id: string;
  localId?: string;
  companyId: string;
  assignedTo?: string;
  customerName: string;
  customerPhone?: string;
  address: string;
  lat?: number;
  lng?: number;
  title: string;
  description?: string;
  status: JobStatus;
  scheduledAt?: string;
  materials: Array<{ name: string; qty: number; unit?: string; unit_price?: number }>;
  notes?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

export interface VoiceLogOutput {
  formatted_notes: string;
  materials: Array<{ name: string; qty: number; unit?: string }>;
  follow_up_task: { title: string; due_date?: string } | null;
  confidence: number;
  transcript: string;
}

export interface ReceiptOutput {
  vendor: string;
  date: string; // ISO
  line_items: Array<{ desc: string; qty: number; price: number }>;
  total: number;
  tax?: number;
  currency: string;
}

export interface ChecklistField {
  key: string;
  label: string;
  type: 'pass_fail' | 'checkbox' | 'text' | 'photo' | 'select';
  required?: boolean;
  options?: string[];
}

export type OutboxOp = 'insert' | 'update' | 'delete';
export type OutboxStatus = 'pending' | 'syncing' | 'failed';
