import test from 'ava';
import * as http2 from 'http2';

import {AssetCache} from '../src/asset-cache';

function delay(msec: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, msec));
}

function setEqual<T>(set: Set<T>, ...values: T[]): boolean {
  return set.size === values.length && values.every(v => set.has(v));
}

function newAssetCache({
  warmupDuration = 10,
  promotionRatio = 0.8,
  demotionRatio = 0.2,
  minimumRequests = 1
}): AssetCache {
  return new AssetCache(
      {warmupDuration, promotionRatio, demotionRatio, minimumRequests});
}

test.beforeEach('create session', t => {
  t.context.session = {};
});

test('request paths are recorded', async t => {
  const cache = newAssetCache({});
  const session: http2.Http2Session = t.context.session;

  // Should record related paths for '/foo'.
  cache.recordRequestPath(session, '/foo', false);
  cache.recordRequestPath(session, '/bar', true);
  cache.recordRequestPath(session, '/baz', false);  // non-static
  cache.recordRequestPath(session, '/bah', true);
  await delay(20);
  // '/baz' is not included because it's non-static.
  t.true(setEqual(cache.getAssetsForPath('/foo'), '/bar', '/bah'));

  // And now for '/boo'.
  cache.recordRequestPath(session, '/boo', false);
  cache.recordRequestPath(session, '/zoo', true);
  await delay(20);
  t.true(setEqual(cache.getAssetsForPath('/boo'), '/zoo'));

  // '/foo' already exists in the asset map. Shouldn't record.
  cache.recordRequestPath(session, '/foo', false);
  cache.recordRequestPath(session, '/coo', true);
  await delay(20);
  t.true(setEqual(cache.getAssetsForPath('/foo'), '/bar', '/bah'));
});

test('minimum requests', async t => {
  const cache = newAssetCache({minimumRequests: 2});
  const session: http2.Http2Session = t.context.session;

  const record = async () => {
    cache.recordRequestPath(session, '/foo', false);
    cache.recordRequestPath(session, '/bar', true);
    cache.recordRequestPath(session, '/baz', true);
    await delay(20);
  };
  // At least 2 requests are needed.
  await record();
  t.true(cache.getAssetsForPath('/foo').size === 0);
  await record();
  t.true(setEqual(cache.getAssetsForPath('/foo'), '/bar', '/baz'));
});

test('promotion', async t => {
  const cache = newAssetCache({promotionRatio: 0.6, minimumRequests: 2});
  const session: http2.Http2Session = t.context.session;

  const record1 = async () => {
    cache.recordRequestPath(session, '/foo', false);
    cache.recordRequestPath(session, '/bar', true);
    await delay(20);
  };
  const record2 = async () => {
    cache.recordRequestPath(session, '/foo', false);
    cache.recordRequestPath(session, '/baz', true);
    await delay(20);
  };
  // doesn't meet minimum requests yet
  await record1();
  t.true(cache.getAssetsForPath('/foo').size === 0);
  // success ratio (0.5) < promotion ratio (0.6)
  await record2();
  t.true(cache.getAssetsForPath('/foo').size === 0);
  // success ratio (0.666...) > promotion ratio (0.6) => promoted
  await record1();
  t.true(setEqual(cache.getAssetsForPath('/foo'), '/bar'));
});


test('demotion', async t => {
  const cache = newAssetCache(
      {promotionRatio: 0.6, demotionRatio: 0.5, minimumRequests: 2});
  const session: http2.Http2Session = t.context.session;

  const record1 = async () => {
    cache.recordRequestPath(session, '/foo', false);
    cache.recordRequestPath(session, '/bar', true);
    await delay(20);
  };
  const record2 = async () => {
    cache.recordRequestPath(session, '/foo', false);
    cache.recordRequestPath(session, '/baz', true);
    await delay(20);
  };
  // doesn't meet minimum requests yet
  await record1();
  t.true(cache.getAssetsForPath('/foo').size === 0);
  // success ratio (0.5) <= demotion ratio (0.5) ==> demoted & fresh start
  await record2();
  t.true(cache.getAssetsForPath('/foo').size === 0);
  // success ratio (1.0) > promotion ratio (0.6) => promoted
  await record2();
  t.true(setEqual(cache.getAssetsForPath('/foo'), '/baz'));
});
