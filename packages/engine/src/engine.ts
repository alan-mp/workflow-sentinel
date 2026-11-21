import { buildFacts, resolveApprovers, resolveDirect, validateData, walk } from './routing';
import { EngineError, type AuditEvent, type Delegation, type Directory, type User } from './types';
import type { FlowVersion } from './versions';

export interface Task {
  id: string;
  stepId: string;
  round: number;
  /** Siapa pun di daftar ini boleh memutuskan; satu keputusan cukup. */
  assignees: string[];
  status: 'open' | 'approved' | 'rejected' | 'revision_requested' | 'cancelled';
  createdAt: string;
  dueAt?: string;
  actedBy?: string;
  /** Terisi kalau keputusan diambil lewat delegasi. */
  onBehalfOf?: string;
  actedAt?: string;
}

export interface RequestState {
  id: string;
  flowKey: string;
  /** Versi alur saat permintaan dibuat; tidak berubah selama permintaan berjalan. */
  flowVersionId: string;
  requesterId: string;
  data: Record<string, unknown>;
  status: 'in_progress' | 'approved' | 'rejected' | 'revision_requested';
  /** Bertambah setiap kali pemohon mengirim ulang setelah revisi. */
  round: number;
  completedSteps: Record<string, 'approved' | 'skipped'>;
  notifiedSteps: string[];
  tasks: Task[];
}

export interface EngineContext {
  directory: Directory;
  now: Date;
  /** Delegasi yang relevan untuk aktor; mesin memeriksa masa berlakunya. */
  delegations?: Delegation[];
}

export interface Result {
  state: RequestState;
  /** Event baru untuk ditambahkan ke audit trail. */
  events: AuditEvent[];
}

async function requireUser(directory: Directory, id: string): Promise<User> {
  const user = await directory.getUser(id);
  if (!user) throw new EngineError('FORBIDDEN', `User ${id} tidak ada di direktori`);
  return user;
}

function requireVersion(state: RequestState, version: FlowVersion) {
  if (version.id !== state.flowVersionId) {
    throw new EngineError('INVALID_STATE', 'Permintaan harus diproses dengan versi alur saat dibuat');
  }
}

/** Membuka langkah berikutnya, atau menyelesaikan permintaan. Mengubah `state`. */
async function advance(state: RequestState, version: FlowVersion, ctx: EngineContext): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [];
  const at = ctx.now.toISOString();
  const base = { at, flowVersionId: version.id, requestId: state.id };
  const requester = await requireUser(ctx.directory, state.requesterId);
  const facts = buildFacts(state.data, requester);

  const done = await walk(version.definition.steps, facts, {
    approval: async (step) => {
      if (state.completedSteps[step.id]) return true;
      if (state.tasks.some((t) => t.stepId === step.id && t.round === state.round && t.status === 'open')) {
        return false;
      }
      const r = await resolveApprovers(step.approver, {
        definition: version.definition,
        requester,
        facts,
        directory: ctx.directory,
      });
      if (r.skipped) {
        state.completedSteps[step.id] = 'skipped';
        events.push({
          ...base,
          actor: { type: 'system' },
          action: 'step_skipped',
          stepId: step.id,
          detail: { tableRow: r.tableRow },
        });
        return true;
      }
      const task: Task = {
        id: `${state.id}:r${state.round}:${step.id}`,
        stepId: step.id,
        round: state.round,
        assignees: r.assignees,
        status: 'open',
        createdAt: at,
        dueAt: step.slaHours
          ? new Date(ctx.now.getTime() + step.slaHours * 3_600_000).toISOString()
          : undefined,
      };
      state.tasks.push(task);
      events.push({
        ...base,
        actor: { type: 'system' },
        action: 'task_created',
        stepId: step.id,
        taskId: task.id,
        detail: {
          assignees: r.assignees,
          dueAt: task.dueAt,
          tableRow: r.tableRow,
          requesterExcluded: r.requesterExcluded,
          reroutedToManager: r.reroutedToManager,
        },
      });
      return false;
    },
    notify: async (step) => {
      if (state.notifiedSteps.includes(step.id)) return;
      state.notifiedSteps.push(step.id);
      const recipients =
        step.to.kind === 'requester' ? [requester.id] : await resolveDirect(step.to, requester, ctx.directory);
      events.push({
        ...base,
        actor: { type: 'system' },
        action: 'notification_requested',
        stepId: step.id,
        detail: { recipients, message: step.message },
      });
    },
  });

  if (done) {
    // Tidak ada auto-approve: permintaan hanya selesai kalau ada manusia yang menyetujui.
    if (!Object.values(state.completedSteps).includes('approved')) {
      throw new EngineError('ROUTING', 'Tidak ada langkah approval yang berlaku untuk permintaan ini');
    }
    state.status = 'approved';
    events.push({ ...base, actor: { type: 'system' }, action: 'request_approved' });
  }
  return events;
}

export async function startRequest(
  version: FlowVersion,
  input: { id: string; requesterId: string; data: Record<string, unknown> },
  ctx: EngineContext,
): Promise<Result> {
  const at = ctx.now.toISOString();
  if (version.status !== 'active' || !version.effectiveFrom || version.effectiveFrom > at) {
    throw new EngineError('INVALID_STATE', 'Versi alur belum aktif atau belum berlaku');
  }
  await requireUser(ctx.directory, input.requesterId);
  validateData(version.definition.fields, input.data);

  const state: RequestState = {
    id: input.id,
    flowKey: version.flowKey,
    flowVersionId: version.id,
    requesterId: input.requesterId,
    data: structuredClone(input.data),
    status: 'in_progress',
    round: 1,
    completedSteps: {},
    notifiedSteps: [],
    tasks: [],
  };
  const events: AuditEvent[] = [
    {
      at,
      actor: { type: 'user', id: input.requesterId },
      action: 'request_submitted',
      flowVersionId: version.id,
      requestId: state.id,
      detail: { round: 1 },
    },
  ];
  events.push(...(await advance(state, version, ctx)));
  return { state, events };
}

export interface Decision {
  actorId: string;
  taskId: string;
  type: 'approve' | 'reject' | 'request_revision';
  comment?: string;
  attachmentIds?: string[];
}

export async function act(
  current: RequestState,
  version: FlowVersion,
  decision: Decision,
  ctx: EngineContext,
): Promise<Result> {
  requireVersion(current, version);
  const state = structuredClone(current);
  const at = ctx.now.toISOString();
  if (state.status !== 'in_progress') {
    throw new EngineError('INVALID_STATE', 'Permintaan tidak sedang menunggu approval');
  }
  const task = state.tasks.find((t) => t.id === decision.taskId);
  if (!task || task.status !== 'open') throw new EngineError('INVALID_STATE', 'Tugas approval tidak terbuka');
  await requireUser(ctx.directory, decision.actorId);

  // Pemisahan tugas: berlaku apa pun isi daftar approver atau delegasinya.
  if (decision.actorId === state.requesterId) {
    throw new EngineError('SOD_VIOLATION', 'Pemohon tidak boleh memutuskan permintaannya sendiri');
  }
  let onBehalfOf: string | undefined;
  if (!task.assignees.includes(decision.actorId)) {
    const delegation = (ctx.delegations ?? []).find(
      (d) =>
        d.toUserId === decision.actorId &&
        task.assignees.includes(d.fromUserId) &&
        d.startsAt <= at &&
        at < d.endsAt,
    );
    if (!delegation) throw new EngineError('NOT_ASSIGNEE', 'Anda bukan approver untuk tugas ini');
    onBehalfOf = delegation.fromUserId;
  }

  const outcome = { approve: 'approved', reject: 'rejected', request_revision: 'revision_requested' } as const;
  task.status = outcome[decision.type];
  task.actedBy = decision.actorId;
  task.onBehalfOf = onBehalfOf;
  task.actedAt = at;

  const base = { at, flowVersionId: version.id, requestId: state.id };
  const events: AuditEvent[] = [
    {
      ...base,
      actor: { type: 'user', id: decision.actorId },
      action: `task_${task.status}`,
      stepId: task.stepId,
      taskId: task.id,
      detail: { onBehalfOf, comment: decision.comment, attachmentIds: decision.attachmentIds },
    },
  ];

  if (decision.type === 'approve') {
    state.completedSteps[task.stepId] = 'approved';
    events.push(...(await advance(state, version, ctx)));
    return { state, events };
  }

  for (const other of state.tasks) {
    if (other.status !== 'open') continue;
    other.status = 'cancelled';
    events.push({
      ...base,
      actor: { type: 'system' },
      action: 'task_cancelled',
      stepId: other.stepId,
      taskId: other.id,
    });
  }
  state.status = decision.type === 'reject' ? 'rejected' : 'revision_requested';
  events.push({ ...base, actor: { type: 'system' }, action: `request_${state.status}` });
  return { state, events };
}

/** Pemohon mengirim ulang setelah diminta revisi; approval diulang dari awal. */
export async function resubmit(
  current: RequestState,
  version: FlowVersion,
  input: { actorId: string; data: Record<string, unknown> },
  ctx: EngineContext,
): Promise<Result> {
  requireVersion(current, version);
  if (current.status !== 'revision_requested') {
    throw new EngineError('INVALID_STATE', 'Permintaan tidak sedang menunggu revisi');
  }
  if (input.actorId !== current.requesterId) {
    throw new EngineError('FORBIDDEN', 'Hanya pemohon yang boleh mengirim ulang');
  }
  validateData(version.definition.fields, input.data);
  const state = structuredClone(current);
  state.data = structuredClone(input.data);
  state.status = 'in_progress';
  state.round += 1;
  state.completedSteps = {};
  state.notifiedSteps = [];
  const events: AuditEvent[] = [
    {
      at: ctx.now.toISOString(),
      actor: { type: 'user', id: input.actorId },
      action: 'request_resubmitted',
      flowVersionId: version.id,
      requestId: state.id,
      detail: { round: state.round },
    },
  ];
  events.push(...(await advance(state, version, ctx)));
  return { state, events };
}
