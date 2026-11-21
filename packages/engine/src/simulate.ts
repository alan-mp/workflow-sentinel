import type { FlowDefinition } from './definition';
import { buildFacts, resolveApprovers, resolveDirect, validateData, walk } from './routing';
import { EngineError, type Directory } from './types';

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
): Promise<SimulatedStep[]> {
  const requester = await directory.getUser(input.requesterId);
  if (!requester) throw new EngineError('INVALID_DATA', `User ${input.requesterId} tidak ada di direktori`);
  validateData(definition.fields, input.data);
  const facts = buildFacts(input.data, requester);
  const out: SimulatedStep[] = [];
  const parallelStack: string[] = [];
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
        const r = await resolveApprovers(step.approver, { definition, requester, facts, directory });
        Object.assign(row, {
          userIds: r.assignees,
          skipped: r.skipped,
          tableRow: r.tableRow,
          requesterExcluded: r.requesterExcluded,
          reroutedToManager: r.reroutedToManager,
        });
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
          step.to.kind === 'requester' ? [requester.id] : await resolveDirect(step.to, requester, directory);
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
