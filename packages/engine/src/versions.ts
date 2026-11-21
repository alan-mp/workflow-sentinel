import type { FlowDefinition } from './definition';
import { EngineError, type Actor, type AuditEvent } from './types';
import { assertCompilable } from './rules';
import { validateDefinition } from './validate';

export interface FlowVersion {
  id: string;
  flowKey: string;
  version: number;
  status: 'draft' | 'active';
  definition: FlowDefinition;
  /** Tautan ke SOP/policy yang menjadi dasar versi ini. */
  sopUrl?: string;
  createdBy: string;
  /** Semua orang yang pernah mengubah draf ini, termasuk pembuatnya. */
  editedBy: string[];
  /** Tanggal mulai berlaku (ISO). */
  effectiveFrom?: string;
  activatedBy?: string;
  activatedAt?: string;
}

export function createDraft(input: {
  id: string;
  flowKey: string;
  version: number;
  definition: FlowDefinition;
  createdBy: string;
  sopUrl?: string;
}): FlowVersion {
  return { ...input, status: 'draft', editedBy: [input.createdBy] };
}

/** Versi aktif tidak bisa diubah; perubahan selalu lewat draf versi baru. */
export function editDraft(
  version: FlowVersion,
  editorId: string,
  changes: { definition?: FlowDefinition; sopUrl?: string },
): FlowVersion {
  if (version.status !== 'draft') {
    throw new EngineError('INVALID_STATE', 'An active version cannot be edited');
  }
  return {
    ...version,
    ...changes,
    editedBy: version.editedBy.includes(editorId) ? version.editedBy : [...version.editedBy, editorId],
  };
}

/**
 * Mengaktifkan draf. Hanya manusia yang bukan penyusun draf yang boleh
 * melakukannya; AI selalu ditolak.
 */
export function activateVersion(
  version: FlowVersion,
  input: { actor: Actor; effectiveFrom: string; now: Date; adminOverride?: boolean },
): { version: FlowVersion; events: AuditEvent[] } {
  const { actor, effectiveFrom, now } = input;
  // Admin sistem boleh mengaktifkan draf yang ia susun sendiri; pengecualian ini selalu tercatat di audit.
  const selfActivated = version.editedBy.includes(actor.type === 'user' ? actor.id : '');
  if (actor.type !== 'user') {
    throw new EngineError('FORBIDDEN', 'Only a person can activate a flow');
  }
  if (version.status !== 'draft') throw new EngineError('INVALID_STATE', 'This version is already active');
  if (selfActivated && !input.adminOverride) {
    throw new EngineError('SOD_VIOLATION', 'Draft authors cannot activate their own draft');
  }
  if (!version.sopUrl) throw new EngineError('INVALID_DEFINITION', 'Add the source SOP link before activating');
  if (Number.isNaN(Date.parse(effectiveFrom))) {
    throw new EngineError('INVALID_DEFINITION', 'Effective date is not valid');
  }
  const result = validateDefinition(version.definition);
  if (!result.ok) {
    const first = result.issues.find((i) => i.level === 'error')!;
    throw new EngineError('INVALID_DEFINITION', first.message);
  }
  assertCompilable(version.definition);
  const at = now.toISOString();
  return {
    version: { ...version, status: 'active', effectiveFrom, activatedBy: actor.id, activatedAt: at },
    events: [
      {
        at,
        actor,
        action: 'version_activated',
        flowVersionId: version.id,
        detail: { effectiveFrom, sopUrl: version.sopUrl, editedBy: version.editedBy, ...(selfActivated ? { adminOverride: true } : {}) },
      },
    ],
  };
}

/** Versi yang dipakai permintaan baru: versi aktif terbaru yang sudah berlaku. */
export function pickVersion(versions: FlowVersion[], now: Date): FlowVersion | undefined {
  const at = now.toISOString();
  return versions
    .filter((v) => v.status === 'active' && v.effectiveFrom !== undefined && v.effectiveFrom <= at)
    .sort((a, b) => (a.effectiveFrom! < b.effectiveFrom! ? 1 : -1))[0];
}
