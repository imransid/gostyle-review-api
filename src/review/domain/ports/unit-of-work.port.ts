/**
 * A transaction, opaque to everything above persistence.
 *
 * Handlers open one and pass it to every repository write, so a review, its
 * invite, the summary delta and the outbox rows commit together or not at all.
 * The domain and application layers never see what is inside.
 */
export interface TxHandle {
  readonly __brand: 'TxHandle';
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface UnitOfWork {
  run<T>(work: (tx: TxHandle) => Promise<T>): Promise<T>;
}
