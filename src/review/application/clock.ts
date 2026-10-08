export const CLOCK = Symbol('CLOCK');

/** The time, as a port, so a handler spec can pin "now". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
