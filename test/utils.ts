import * as ava from 'ava';

export function contextualize<T>(getContext: () => T):
    ava.RegisterContextual<T> {
  ava.test.beforeEach(t => {
    t.context = getContext();
  });
  return ava.test;
}

export function delay(msec: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, msec));
}

export function setEqual<T>(set: Set<T>, ...values: T[]): boolean {
  return set.size === values.length && values.every(v => set.has(v));
}
