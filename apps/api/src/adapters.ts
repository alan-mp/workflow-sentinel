import type { RequestState } from '@sentinel/engine';

/**
 * Batas ke ERP. Alur approval hanya mengenal interface ini, jadi ERP bisa
 * diganti dengan menulis implementasi baru. Modul AI tidak punya akses ke sini.
 */
export interface ErpAdapter {
  /** Dipanggil setelah permintaan disetujui penuh. Null = tidak ada yang dikirim. */
  pushApproved(request: RequestState): Promise<{ reference: string } | null>;
}

/** Pengganti ERP untuk PoC: hanya permintaan pembelian yang "dikirim". */
export class MockErpAdapter implements ErpAdapter {
  async pushApproved(request: RequestState) {
    if (request.flowKey !== 'purchase') return null;
    return { reference: `MOCK-PR-${request.id}` };
  }
}

export interface EmailNotifier {
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

/** Pengganti email untuk PoC: hanya mencatat ke log Worker. */
export class LogEmailNotifier implements EmailNotifier {
  async send(message: { to: string; subject: string; body: string }) {
    console.log(`[email] to ${message.to}: ${message.subject}`);
  }
}
