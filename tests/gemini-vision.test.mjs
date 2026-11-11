import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImages, MODEL } from '../plugins/gemini-vision.mjs';

const png = Buffer.from([137,80,78,71,13,10,26,10]);
function context(data = png) {
  return {
    workingDirectory: { ensure: async () => '/workspace' },
    fs: {
      resolve: async path => path, contains: (_root, target) => target.startsWith('/workspace/'),
      stat: async () => ({ type: 'file' }),
      readBytes: async (_target, _signal, max) => { assert.equal(max, 8 * 1024 * 1024); return data; },
    },
    credentials: { resolve: async ref => { assert.equal(ref, 'LFZXB_API_KEY'); return { value: 'test-secret' }; } },
  };
}
const args = { file_paths: ['/workspace/upload.png'], question: '图里有什么？' };
const exec = { agent: {} };

test('image bytes go to the specified Gemini model and return observations', async () => {
  const result = await analyzeImages(context(), args, exec, async (url, options) => {
    assert.equal(url, 'https://api.lfzxb.top/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, MODEL);
    assert.equal(body.thinking, undefined);
    assert.equal(body.messages[1].content[1].image_url.url, `data:image/png;base64,${png.toString('base64')}`);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '红色方块' }, finish_reason: 'stop' }] }) };
  });
  assert.deepEqual(result, { model: MODEL, analysis: '红色方块', truncated: false });
});

test('out-of-workspace and non-image files are rejected before network use', async () => {
  const noFetch = async () => { assert.fail('network must not be used'); };
  await assert.rejects(analyzeImages(context(), { ...args, file_paths: ['/secrets/key'] }, exec, noFetch), /inside/);
  await assert.rejects(analyzeImages(context(Buffer.from('not an image')), args, exec, noFetch), /Unsupported/);
  await assert.rejects(analyzeImages(context(), { ...args, file_paths: [] }, exec, noFetch), /1 to 6/);
});

test('API failure and empty output do not claim successful recognition', async () => {
  await assert.rejects(analyzeImages(context(), args, exec, async () => ({ ok: false, status: 503 })), /HTTP 503/);
  await assert.rejects(analyzeImages(context(), args, exec, async () => ({ ok: true, json: async () => ({ choices: [] }) })), /no image analysis/);
});
