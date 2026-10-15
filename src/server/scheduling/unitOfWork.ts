import type { Db } from '../db/client';
import { Outbox } from '../repo/outbox';
import { ShiftRepository } from '../repo/shifts';

/** The repositories a write may use; all of them share one transaction. */
export interface WriteScope {
  shifts: ShiftRepository;
  outbox: Outbox;
}

/**
 * Runs a change and the notifications it causes in one transaction, so either
 * both are saved or neither is. Reused by every shift write.
 */
export class UnitOfWork {
  constructor(private readonly db: Db, private readonly org: string) {}

  run<T>(work: (scope: WriteScope) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => {
      const db = tx as unknown as Db;
      return work({ shifts: new ShiftRepository(db, this.org), outbox: new Outbox(db, this.org) });
    });
  }
}
