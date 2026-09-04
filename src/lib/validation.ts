import { z } from 'zod';

export const jobCreateSchema = z.object({
  title: z.string().trim().min(3, 'Title ≥3 chars').max(120),
  customerName: z.string().trim().min(2, 'Customer ≥2 chars').max(80),
  customerPhone: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Phone must be +61...').optional().or(z.literal('')),
  address: z.string().trim().min(5, 'Address ≥5 chars').max(200),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export const companySchema = z.object({
  name: z.string().trim().min(1, 'Company name required').max(120),
  abn: z.string().trim().regex(/^[0-9 ]{0,20}$/, 'ABN digits/spaces only').optional().or(z.literal('')),
});

export const checklistResponseSchema = z.record(z.unknown());

export const inviteSchema = z.object({
  phone: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Valid phone required'),
  displayName: z.string().trim().max(80).optional().or(z.literal('')),
  role: z.enum(['technician', 'admin']),
});

export type JobCreateInput = z.infer<typeof jobCreateSchema>;
