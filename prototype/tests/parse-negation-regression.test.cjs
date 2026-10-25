'use strict';

// 运行 X/Y 两版实际脚本：带修饰的否定说法不当正向证据，也不推断低分。
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
  ['不够主动', '林知远不够主动提出方案。'],
  ['没能主动', '林知远没能主动提出方案。'],
];

for (const version of Object.keys(versions)) {
  for (const [label, text] of negatives) {
    test(`版本 ${version}：${label} 保持资料不足，不出分`, () => {
      const result = motivation(version, text);
      assert.ok(result, '应保留资料不足的解释');
      assert.equal(result.v, null);
      assert.equal(result.st, 'unknown');
      assert.equal(result.ai, undefined);
    });
  }

  test(`版本 ${version}：不够主动之后出现实际主动行为仍可按后者建议`, () => {
    const result = motivation(version, '林知远不够主动，但后来主动改进了方案。');
    assert.equal(result.v, 4);
    assert.equal(result.st, 'ai');
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
