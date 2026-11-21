import type { FlowDefinition } from './definition';
import { EngineError, type Actor, type AuditEvent } from './types';
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
    throw new EngineError('INVALID_STATE', 'Versi yang sudah aktif tidak bisa diubah');
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
  input: { actor: Actor; effectiveFrom: string; now: Date },
): { version: FlowVersion; events: AuditEvent[] } {
  const { actor, effectiveFrom, now } = input;
  if (actor.type !== 'user') {
    throw new EngineError('FORBIDDEN', 'Hanya manusia yang boleh mengaktifkan alur');
  }
  if (version.status !== 'draft') throw new EngineError('INVALID_STATE', 'Versi ini sudah aktif');
  if (version.editedBy.includes(actor.id)) {
    throw new EngineError('SOD_VIOLATION', 'Penyusun draf tidak boleh mengaktifkan drafnya sendiri');
  }
  if (!version.sopUrl) throw new EngineError('INVALID_DEFINITION', 'Tautan SOP sumber belum diisi');
  if (Number.isNaN(Date.parse(effectiveFrom))) {
    throw new EngineError('INVALID_DEFINITION', 'Tanggal berlaku tidak valid');
  }
  const result = validateDefinition(version.definition);
  if (!result.ok) {
    const first = result.issues.find((i) => i.level === 'error')!;
    throw new EngineError('INVALID_DEFINITION', first.message);
  }
  const at = now.toISOString();
  return {
    version: { ...version, status: 'active', effectiveFrom, activatedBy: actor.id, activatedAt: at },
    events: [
      {
        at,
        actor,
        action: 'version_activated',
        flowVersionId: version.id,
        detail: { effectiveFrom, sopUrl: version.sopUrl, editedBy: version.editedBy },
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
