import { z } from 'zod';

// Definisi alur = langkah (diagram) + tabel aturan routing. Seluruhnya data,
// disimpan sebagai JSON berversi. Chat dan editor visual mengedit objek ini.

const Id = z.string().regex(/^[a-z0-9_]+$/, 'hanya huruf kecil, angka, dan _');

export const FieldSchema = z
  .object({
    key: Id,
    label: z.string().min(1),
    type: z.enum(['number', 'string', 'boolean', 'date']),
    optional: z.boolean().optional(),
  })
  .strict();
export type Field = z.infer<typeof FieldSchema>;

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export const ConditionSchema = z
  .object({
    /** Kunci field permintaan, atau "requester.department". */
    field: z.string().min(1),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']),
    value: z.union([Scalar, z.array(Scalar)]),
  })
  .strict();
export type Condition = z.infer<typeof ConditionSchema>;

const ManagerApprover = z
  .object({ kind: z.literal('manager'), level: z.number().int().min(1).max(5) })
  .strict();
const RoleApprover = z.object({ kind: z.literal('role'), role: Id }).strict();
const UserApprover = z.object({ kind: z.literal('user'), userId: z.string().min(1) }).strict();

/** Approver yang ditunjuk langsung (bukan lewat tabel). */
export const DirectApproverSchema = z.discriminatedUnion('kind', [
  ManagerApprover,
  RoleApprover,
  UserApprover,
]);
export type DirectApprover = z.infer<typeof DirectApproverSchema>;

export const ApproverSpecSchema = z.discriminatedUnion('kind', [
  ManagerApprover,
  RoleApprover,
  UserApprover,
  z.object({ kind: z.literal('table'), tableId: Id }).strict(),
]);
export type ApproverSpec = z.infer<typeof ApproverSpecSchema>;

export const RuleRowSchema = z
  .object({
    id: Id,
    /** Semua kondisi harus terpenuhi (AND). Kosong = baris default. */
    when: z.array(ConditionSchema),
    /** "none" = langkah ini tidak diperlukan untuk baris ini. */
    approver: z.discriminatedUnion('kind', [
      ManagerApprover,
      RoleApprover,
      UserApprover,
      z.object({ kind: z.literal('none') }).strict(),
    ]),
  })
  .strict();
export type RuleRow = z.infer<typeof RuleRowSchema>;

/** Tabel aturan routing: baris pertama yang cocok dipakai. */
export const RuleTableSchema = z
  .object({ id: Id, name: z.string().min(1), rows: z.array(RuleRowSchema).min(1) })
  .strict();
export type RuleTable = z.infer<typeof RuleTableSchema>;

export interface ApprovalStep {
  type: 'approval';
  id: string;
  name: string;
  approver: ApproverSpec;
  /** Batas waktu pengerjaan; dipakai untuk pengingat dan eskalasi. */
  slaHours?: number;
}
export interface ConditionStep {
  type: 'condition';
  id: string;
  name: string;
  branches: { when: Condition[]; steps: Step[] }[];
  otherwise: Step[];
}
export interface ParallelStep {
  type: 'parallel';
  id: string;
  name: string;
  /** Semua cabang harus selesai sebelum lanjut. */
  branches: Step[][];
}
export interface NotifyStep {
  type: 'notify';
  id: string;
  name: string;
  to: DirectApprover | { kind: 'requester' };
  message: string;
}
export type Step = ApprovalStep | ConditionStep | ParallelStep | NotifyStep;

export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('approval'),
        id: Id,
        name: z.string().min(1),
        approver: ApproverSpecSchema,
        slaHours: z.number().positive().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('condition'),
        id: Id,
        name: z.string().min(1),
        branches: z
          .array(z.object({ when: z.array(ConditionSchema).min(1), steps: z.array(StepSchema) }).strict())
          .min(1),
        otherwise: z.array(StepSchema),
      })
      .strict(),
    z
      .object({
        type: z.literal('parallel'),
        id: Id,
        name: z.string().min(1),
        branches: z.array(z.array(StepSchema).min(1)).min(2),
      })
      .strict(),
    z
      .object({
        type: z.literal('notify'),
        id: Id,
        name: z.string().min(1),
        to: z.discriminatedUnion('kind', [
          ManagerApprover,
          RoleApprover,
          UserApprover,
          z.object({ kind: z.literal('requester') }).strict(),
        ]),
        message: z.string().min(1),
      })
      .strict(),
  ]),
);

export const FlowDefinitionSchema = z
  .object({
    key: Id,
    name: z.string().min(1),
    fields: z.array(FieldSchema),
    tables: z.array(RuleTableSchema),
    steps: z.array(StepSchema).min(1),
  })
  .strict();
export interface FlowDefinition {
  key: string;
  name: string;
  fields: Field[];
  tables: RuleTable[];
  steps: Step[];
}

/** Field bawaan yang boleh dipakai di kondisi selain field permintaan. */
export const BUILTIN_FIELDS: Record<string, Field['type']> = {
  'requester.department': 'string',
};
