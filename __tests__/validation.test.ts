const { z } = require('zod');

const jobSchema = z.object({
  title: z.string().min(3).max(120),
  customerName: z.string().min(2).max(80),
  address: z.string().min(5).max(200),
  phone: z.string().regex(/^\+?[0-9 ]{7,20}$/).optional().or(z.literal('')),
});

describe('Job input validation', () => {
  it('rejects empty title', () => {
    expect(() => jobSchema.parse({ title: '', customerName: 'Bob', address: '1 St' })).toThrow();
  });
  it('accepts valid AU phone', () => {
    expect(jobSchema.parse({ title: 'Fix tap', customerName: 'Bob', address: '1 Smith St', phone: '+61 400 123 456' }).phone).toBe('+61 400 123 456');
  });
  it('rejects bad phone', () => {
    expect(() => jobSchema.parse({ title: 'Fix', customerName: 'Bob', address: '1 St', phone: 'abc' })).toThrow();
  });
});

const checklistResult = z.enum(['pass', 'fail', 'pending']);
describe('Checklist result enum', () => {
  it('only allows pass/fail/pending', () => {
    expect(checklistResult.parse('pass')).toBe('pass');
    expect(() => checklistResult.parse('unknown')).toThrow();
  });
});
