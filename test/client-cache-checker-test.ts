import test from 'ava';
import {ClientCacheChecker} from '../src/client-cache-checker';

test('basic test', t => {
  const ccc = new ClientCacheChecker();
  for (let i = 0; i < 100; i++) {
    ccc.addPath('' + i);
  }
  for (let i = 0; i < 100; i++) {
    if (!ccc.test('' + i)) {
      t.fail(`Failed for ${i}`);
    }
  }
  t.false(ccc.test('100'));
});

test('serialization', t => {
  const ccc = new ClientCacheChecker();
  ccc.addPath('foo');
  ccc.addPath('bar');

  // serialize & deserialize back
  const serialized = ccc.serialize();
  const newCcc = ccc.deserialize(serialized);
  t.true(ccc.test('foo'));
  t.true(ccc.test('bar'));
  t.false(ccc.test('baz'));
});
