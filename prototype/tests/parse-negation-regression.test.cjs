'use strict';

// 运行 X/Y 两版实际脚本：一般否定不自动评分，「不够主动」仅供 2 分待复核候选。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const versions = {
  X: '../app/js/parse.js',
  Y: '../y/app/js/parse.js',
};

function motivation(version, text) {
  const script = fs.readFileSync(path.join(__dirname, versions[version]), 'utf8');
  const NT = { store: { person: () => ({ name: '林知远' }) } };
  vm.runInNewContext(script, { window: { NT } }, { filename: versions[version] });
  return NT.parse.shape(text, 'demo-lin').scores.find((s) => s.d === 'mot');
}

const negatives = [
  ['不太主动', '林知远不太主动提出方案。'],
  ['未能主动', '林知远未能主动提出方案。'],
  ['没有主动', '林知远没有主动提出方案。'],
];

for (const version of Object.keys(versions)) {
  for (const [label, text] of negatives) {
    test(`版本 ${version}：${label} 不自动生成内生动力正向分`, () => {
      const result = motivation(version, text);
      assert.ok(result, '应保留资料不足的解释');
      assert.equal(result.v, null);
      assert.equal(result.st, 'unknown');
      assert.equal(result.ai, undefined);
    });
  }

  test(`版本 ${version}：不够主动生成须人工确认的 2 分候选`, () => {
    const result = motivation(version, '林知远不够主动提出方案。');
    assert.equal(result.v, 2);
    assert.equal(result.ai, 2);
    assert.equal(result.st, 'ai');
    assert.equal(result.reviewRequired, true);
    assert.match(result.note, /补充具体行为/);
  });

  test(`版本 ${version}：低分候选未逐项确认，保存后仍为 AI 建议`, () => {
    const script = fs.readFileSync(path.join(__dirname, versions[version]), 'utf8');
    const NT = {
      TODAY: '2026-10-25',
      uid: () => 'demo-record',
      md: (value) => value,
      store: {
        person: () => ({ name: '林知远' }),
        me: () => ({ id: 'mentor-demo', name: '演示导师' }),
        addEvent: (event) => event,
      },
    };
    vm.runInNewContext(script, { window: { NT } }, { filename: versions[version] });
    const text = '林知远不够主动提出方案。';
    const scores = NT.parse.shape(text, 'demo-lin').scores;
    const payload = { pid: 'demo-lin', scores, text, title: '演示记录', bg: '', act: '', res: '' };
    const pending = NT.parse.commit(payload).e.scores.find((s) => s.d === 'mot');
    assert.equal(pending.v, 2);
    assert.equal(pending.st, 'ai');
    assert.equal(pending.by, undefined);

    scores.find((s) => s.d === 'mot').st = 'confirmed';
    const confirmed = NT.parse.commit(payload).e.scores.find((s) => s.d === 'mot');
    assert.equal(confirmed.v, 2);
    assert.equal(confirmed.st, 'confirmed');
    assert.equal(confirmed.by, 'mentor-demo');
  });

  test(`版本 ${version}：不够主动之后出现实际主动行为仍可按后者建议`, () => {
    const result = motivation(version, '林知远不够主动，但后来主动改进了方案。');
    assert.equal(result.v, 4);
    assert.equal(result.st, 'ai');
    assert.equal(result.reviewRequired, undefined);
  });

  test(`版本 ${version}：肯定的主动行为仍产生候选建议`, () => {
    const result = motivation(version, '林知远主动提出方案并跟进落实。');
    assert.equal(result.v, 4);
    assert.equal(result.ai, 4);
    assert.equal(result.st, 'ai');
  });

  test(`版本 ${version}：先否定、后有主动行为时保留后者证据`, () => {
    const result = motivation(version, '林知远没有主动探索，后来主动改进了方案。');
    assert.equal(result.v, 4);
    assert.equal(result.ai, 4);
    assert.equal(result.st, 'ai');
  });
}
