import { flattenSteps, type DirectApprover, type FlowDefinition } from './definition';
import { requesterFacts } from './org';
import { resolveApprovers, resolveDirect, validateData, walk } from './routing';
import { buildFacts } from './rules';
import { EngineError, type Directory, type User } from './types';

export interface SimulatedStep {
  stepId: string;
  name: string;
  type: 'approval' | 'notify';
  /** Approver atau penerima notifikasi. */
  userIds: string[];
  skipped: boolean;
  /** Terisi kalau langkah berjalan bersamaan dengan langkah lain di blok paralel ini. */
  parallelIn?: string;
  tableRow?: { tableId: string; rowId: string };
  requesterExcluded?: boolean;
  reroutedToManager?: boolean;
  /** Kenapa approver ini yang ditunjuk. */
  basis?: string;
  /** Masalah routing pada langkah ini, misalnya peran tanpa pemegang. */
  error?: string;
}

/**
 * "Permintaan ini akan dirutekan ke siapa": menelusuri alur dengan anggapan
 * semua approver menyetujui. Bisa dipakai pada draf yang belum aktif.
 */
export async function simulate(
  definition: FlowDefinition,
  input: { requesterId: string; data: Record<string, unknown> },
  directory: Directory,
  now: Date = new Date(),
): Promise<SimulatedStep[]> {
  const requester = await directory.getUser(input.requesterId);
  if (!requester) throw new EngineError('INVALID_DATA', `User ${input.requesterId} is not in the directory`);
  validateData(definition.fields, input.data);
  const facts = buildFacts(definition.fields, input.data, requester, await requesterFacts(requester, directory, now));
  const out: SimulatedStep[] = [];
  const parallelStack: string[] = [];
  /** Simulasi menganggap setiap approver tunggal menyetujui, sehingga aturan "tidak mengulang orang" ikut teruji. */
  const alreadyApproved: string[] = [];
  const message = (e: unknown) => (e instanceof EngineError ? e.message : String(e));

  await walk(definition.steps, facts, {
    approval: async (step) => {
      const row: SimulatedStep = {
        stepId: step.id,
        name: step.name,
        type: 'approval',
        userIds: [],
        skipped: false,
        parallelIn: parallelStack[parallelStack.length - 1],
      };
      try {
        const r = await resolveApprovers(step.approver, { definition, requester, facts, directory, now, alreadyApproved: [...alreadyApproved] });
        Object.assign(row, {
          userIds: r.assignees,
          skipped: r.skipped,
          tableRow: r.tableRow,
          requesterExcluded: r.requesterExcluded,
          reroutedToManager: r.reroutedToManager,
          basis: r.basis,
        });
        if (r.assignees.length === 1 && parallelStack.length === 0) alreadyApproved.push(r.assignees[0]!);
      } catch (e) {
        row.error = message(e);
      }
      out.push(row);
      return true;
    },
    notify: async (step) => {
      const row: SimulatedStep = { stepId: step.id, name: step.name, type: 'notify', userIds: [], skipped: false };
      try {
        row.userIds =
          step.to.kind === 'requester' ? [requester.id] : await resolveDirect(step.to, requester, directory, { now, flowKey: definition.key });
      } catch (e) {
        row.error = message(e);
      }
      out.push(row);
    },
    parallel: (step, phase) => {
      if (phase === 'enter') parallelStack.push(step.id);
      else parallelStack.pop();
    },
  });
  return out;
}

export interface CoverageGap {
  userId: string;
  stepId: string;
  stepName: string;
  /** Baris tabel aturan yang buntu, kalau approver langkah ini ditentukan tabel. */
  tableRow?: { tableId: string; rowId: string };
  message: string;
}

/**
 * Uji cakupan: untuk satu orang sebagai pemohon, coba setiap approver yang
 * mungkin ditunjuk alur ini (termasuk semua baris tabel aturan) dan laporkan
 * yang buntu. Tidak memerlukan isian permintaan.
 */
export async function coverageGaps(definition: FlowDefinition, requester: User, directory: Directory, now: Date = new Date()): Promise<CoverageGap[]> {
  const gaps: CoverageGap[] = [];
  const attempt = async (spec: DirectApprover, at: Omit<CoverageGap, 'message' | 'userId'>) => {
    try {
      await resolveDirect(spec, requester, directory, { now, flowKey: definition.key });
    } catch (e) {
      gaps.push({ ...at, userId: requester.id, message: e instanceof EngineError ? e.message : String(e) });
    }
  };
  for (const step of flattenSteps(definition.steps)) {
    if (step.type !== 'approval') continue;
    const at = { stepId: step.id, stepName: step.name };
    if (step.approver.kind !== 'table') {
      await attempt(step.approver, at);
      continue;
    }
    const table = definition.tables.find((t) => t.id === (step.approver as { tableId: string }).tableId);
    for (const row of table?.rows ?? []) {
      if (row.approver.kind !== 'none') await attempt(row.approver, { ...at, tableRow: { tableId: table!.id, rowId: row.id } });
    }
  }
  return gaps;
}
