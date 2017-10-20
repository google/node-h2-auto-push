import * as express from 'express';
import * as getPort from 'get-port';
import * as http2 from 'http2';

import {AutoPush} from '../src/index';

import {contextualize, delay} from './utils';

const test = contextualize(async () => ({
                             port: await getPort(),
                             server: null as http2.Http2Server | null,
                           }));

test.beforeEach('start server', async t => {
  const app = express();
  const autoPush = new AutoPush({
    warmupDuration: 50,
    promotionRatio: 0.8,
    demotionRatio: 0.2,
    minimumRequests: 1,
  });
  app.use(autoPush.static('test/assets'));
  const context = await t.context;
  context.server = http2.createServer(app).listen(context.port);
});

test.afterEach.always('cleanup', async t => {
  const context = await t.context;
  if (context.server) {
    context.server.close();
  }
});

interface Connection {
  session: http2.ClientHttp2Session;
  pushedPaths: Set<string>;
}

function connect(port: number): Connection {
  const session = http2.connect(`http://localhost:${port}`);
  const pushedPaths = new Set<string>();
  session.on('stream', (pushedStream, requestHeaders) => {
    pushedStream.on('data', () => {
      pushedPaths.add(requestHeaders[':path'] as string);
    });
  });
  return {session, pushedPaths};
}

function request(connection: Connection, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = connection.session.request({':path': path});
    req.on('data', () => {/* Nothing to do */})
        .on('end', resolve)
        .on('error', reject);
  });
}

test('auto-push not more than window size', async t => {
  const connection = connect((await t.context).port);
  connection.session.settings({enablePush: true});
  await Promise.all([
    request(connection, '/index.html'),
    request(connection, '/big.html'),
    request(connection, '/small.html'),
  ]);
  await delay(300);  // delay for warmup

  // verify there's no pushed data yet.
  t.is(connection.pushedPaths.size, 0);

  // this request will initiate auto-push
  await request(connection, '/index.html');
  await delay(300);  // wait a while so we get pushed data

  t.is(connection.pushedPaths.size, 1);
  // small.html should be auto-pushed.
  t.true(connection.pushedPaths.has('/small.html'));
  // big.html is too big to fit in TCP window. shouldn't be auto-pushed.
  t.false(connection.pushedPaths.has('/big.html'));
  connection.session.destroy();
});
