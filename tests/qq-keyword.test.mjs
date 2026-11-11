import test from 'node:test';
import assert from 'node:assert/strict';
import { QqHarnessBridge } from '../logs/qq-keyword-build/src/channels/qq/qq-bridge.mjs';

let nextId = 0;
function message(content, extra = {}) {
  return { kind: 'group', groupOpenid: 'group1', senderId: 'user1',
    messageId: String(++nextId), content, rawEventType: 'GROUP_MESSAGE_CREATE',
    replyTarget: { scope: 'group', targetId: 'group1' }, ...extra };
}
function fixture(options = {}) {
  const calls = [], replies = [], seen = new Set(), sessions = new Map();
  const bridge = new QqHarnessBridge({
    bot: { appId: 'bot', sendText: async (...args) => { replies.push(args); } },
    ownerUserOpenid: '*',
    ...(options.logger ? { logger: options.logger } : {}),
    state: { hasSeen: id => seen.has(id), markSeen: async id => { seen.add(id); },
      sessionFor: key => sessions.get(key), setSession: async (key,id) => { sessions.set(key,id); } },
    harness: { createSession: async () => 'session1', sessionExists: async () => true,
      ask: async (...args) => { calls.push(args); return '在呢'; }, ...options.harness },
    ...(options.accessPolicy ? { accessPolicy: options.accessPolicy } : {}),
  });
  return { bridge, calls, replies };
}

for (const recoveryTool of ['web_fetch', 'web_search']) {
  test(`successful recovery via ${recoveryTool} has no stale failure footer`, async () => {
    const warnings = [];
    const answer = '查到啦，官方文档在这里喵。';
    const f = fixture({ logger: { warn: (...args) => warnings.push(args) }, harness: {
      ask: async (_id, _text, options) => {
        options.onUpdate({ toolName: 'web_fetch', error: true });
        options.onUpdate({ toolName: recoveryTool, error: false });
        return answer;
      },
    } });
    await f.bridge.accept(message('小哈基米查一下'));
    assert.equal(f.replies.length, 1);
    assert.equal(f.replies[0][1], answer);
    assert.equal(warnings.length, 1);
  });
}

test('unresolved limitations in the model answer remain visible without a duplicate technical footer', async () => {
  const answer = '呜，这个日期我暂时还没核实到可靠消息，先不乱报给你喵。';
  const f = fixture({ logger: { warn() {} }, harness: {
    ask: async (_id, _text, options) => {
      options.onUpdate({ toolName: 'web_search', error: true });
      return answer;
    },
  } });
  await f.bridge.accept(message('小哈基米查一下'));
  assert.equal(f.replies[0][1], answer);
});

test('keyword wakes ordinary group chat; unrelated, bot, quoted-only and slash inputs stay silent', async () => {
  const f = fixture();
  for (const m of [message('你好'), message('小哈基米', { senderIsBot: true }),
    message('你好', { raw: { content: '小哈基米' } }), message('/new 小哈基米')]) await f.bridge.accept(m);
  assert.equal(f.calls.length, 0);
  await f.bridge.accept(message('小哈基米在不在'));
  assert.equal(f.calls.length, 1);
  assert.equal(f.replies.length, 1);
  assert.equal(f.bridge.status.lastError, null);
});

test('10-second keyword cooldown is per group; real mentions and private chat bypass it; duplicates stay suppressed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const f = fixture(), first = message('小哈基米');
  await f.bridge.accept(first);
  await f.bridge.accept(first);
  await f.bridge.accept(message('小哈基米再说一句'));
  assert.equal(f.calls.length, 1);
  await f.bridge.accept(message('小哈基米', { groupOpenid: 'group2' }));
  await f.bridge.accept(message('你好', { rawEventType: 'GROUP_AT_MESSAGE_CREATE' }));
  await f.bridge.accept(message('你好', { kind: 'c2c' }));
  assert.equal(f.calls.length, 4);
  t.mock.timers.tick(10000);
  await f.bridge.accept(message('小哈基米回来啦'));
  assert.equal(f.calls.length, 5);
});

test('keyword cannot bypass access policy', async () => {
  const f = fixture({ accessPolicy: { getSettings: () => null } });
  await f.bridge.accept(message('小哈基米'));
  assert.equal(f.calls.length, 0);
  assert.equal(f.bridge.status.messagesRejected, 1);
});

test('busy QQ replies use the persona receipt and preserve FIFO processing', async () => {
  let ready, release;
  const started = new Promise(resolve => { ready = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const prompts = [];
  const f = fixture({ harness: { ask: async (_id, text) => {
    prompts.push(text);
    if (prompts.length === 1) { ready(); await hold; }
    return '回复';
  } } });
  const first = f.bridge.accept(message('第一条', { rawEventType: 'GROUP_AT_MESSAGE_CREATE' }));
  await started;
  const second = f.bridge.accept(message('第二条', { rawEventType: 'GROUP_AT_MESSAGE_CREATE' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.replies[0][1], '听到啦～小哈基米还在回前面那条，等我一下下，马上轮到你喵。');
  assert.deepEqual(prompts, ['第一条']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(prompts, ['第一条', '第二条']);
});

test('keyword cannot consume a pending approval or start another turn', async () => {
  let ready, release, respondCount = 0;
  const presented = new Promise(resolve => { ready = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const f = fixture({ harness: { ask: async (_id, _text, options) => {
    await options.onInteraction({ kind: 'approval', rpcId: 'rpc', sessionId: 'session1',
      payload: { type: 'approval/requested', sessionId: 'session1', approvalId: 'approval1', toolName: 'shell', callId: 'call1' },
      toolCall: { callId: 'call1', name: 'shell', arguments: { command: 'test' } },
      respond: async () => { respondCount++; } });
    ready();
    await hold;
    return 'done';
  } } });
  const turn = f.bridge.accept(message('执行操作', { rawEventType: 'GROUP_AT_MESSAGE_CREATE' }));
  await presented;
  assert.equal(respondCount, 0);
  const count = f.replies.length;
  await f.bridge.accept(message('小哈基米同意'));
  assert.equal(respondCount, 0);
  assert.equal(f.replies.length, count);
  release();
  await turn;
});
