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

const widerNegatives = [
  ['不会主动', '他不会主动同步进度。'],
  ['不是很主动', '他不是很主动。'],
  ['不是主动', '他不是主动认领的。'],
  ['不必主动', '他不必主动推进。'],
  ['不算主动', '这不算主动。'],
  ['没有很主动', '他没有很主动。'],
  ['不怎么主动', '他不怎么主动。'],
];

for (const [label, text] of widerNegatives) {
  test(`版本 X：${label} 保持资料不足，不出分`, () => {
    const result = motivation('X', text);
    assert.ok(result, '应保留资料不足的解释');
    assert.equal(result.v, null);
    assert.equal(result.st, 'unknown');
    assert.equal(result.ai, undefined);
  });
}

test('版本 X：被否定的加分词不把已经成立的主动行为抬到 5 分', () => {
  const result = motivation('X', '没有形成例行，只是这次主动做了。');
  assert.equal(result.v, 4);
  assert.equal(result.st, 'ai');
});

test('版本 X：没有独立定位故障不出专业度分', () => {
  const script = fs.readFileSync(path.join(__dirname, versions.X), 'utf8');
  const NT = { store: { person: () => ({ name: '林知远' }) } };
  vm.runInNewContext(script, { window: { NT } }, { filename: versions.X });
  for (const text of ['他没有独立定位故障。', '这次故障没有独立定位。', '他没有独立定位这次线上故障。']) {
    const prof = NT.parse.shape(text, 'demo-lin').scores.find((s) => s.d === 'prof');
    assert.ok(prof, text);
    assert.equal(prof.v, null, text);
    assert.equal(prof.st, 'unknown', text);
  }
});

test('版本 X：不会接受反馈不出开放性分', () => {
  const script = fs.readFileSync(path.join(__dirname, versions.X), 'utf8');
  const NT = { store: { person: () => ({ name: '林知远' }) } };
  vm.runInNewContext(script, { window: { NT } }, { filename: versions.X });
  const open = NT.parse.shape('他不会接受反馈。', 'demo-lin').scores.find((s) => s.d === 'open');
  assert.ok(open);
  assert.equal(open.v, null);
  assert.equal(open.st, 'unknown');
});

function scoreOf(text, dim) {
  const script = fs.readFileSync(path.join(__dirname, versions.X), 'utf8');
  const NT = { store: { person: () => ({ name: '林知远' }) } };
  vm.runInNewContext(script, { window: { NT } }, { filename: versions.X });
  return NT.parse.shape(text, 'demo-lin').scores.find((s) => s.d === dim);
}

test('版本 X：不仅、不过、不同这类说法仍按正向行为出分', () => {
  assert.equal(scoreOf('他不仅主动认领，还整理成了文档。', 'mot').v, 5);
  assert.equal(scoreOf('他不会主动，不过后来主动改进了方案。', 'mot').v, 4);
  assert.equal(scoreOf('他没有主动、后来主动改进了方案。', 'mot').v, 4);
  assert.equal(scoreOf('他准备了不同方案。', 'wis').v, 4);
  assert.equal(scoreOf('他把没人认领的联调文档补完了。', 'mot').v, 4);
  assert.equal(scoreOf('未来一周他主动同步了进度。', 'mot').v, 4);
  assert.equal(scoreOf('他不停地主动推进。', 'mot').v, 4);
});

test('版本 X：不讨论就直接改仍按锚点 2', () => {
  const wis = scoreOf('他不讨论就直接改了方案。', 'wis');
  assert.equal(wis.v, 2);
  assert.equal(wis.st, 'ai');
});

test('版本 X：被否定的降分行为不靠「方案」出 4 分', () => {
  for (const text of ['他没有直接改方案。', '他不是直接改的方案。', '他没有靠试方案。', '他不是靠试方案。', '他没有一个个试方案。']) {
    const wis = scoreOf(text, 'wis');
    assert.ok(wis, text);
    assert.equal(wis.v, null, text);
    assert.equal(wis.st, 'unknown', text);
  }
  const kept = scoreOf('他对比了方案，不是靠试。', 'wis');
  assert.equal(kept.v, 4);
  assert.equal(kept.st, 'ai');
});

test('版本 X：转折后面的正向行为仍然出分', () => {
  assert.equal(scoreOf('他没有主动但后来主动改进了方案。', 'mot').v, 4);
  assert.equal(scoreOf('他不会主动但后来主动改进了方案。', 'mot').v, 4);
  assert.equal(scoreOf('他主动认领但没有自己查。', 'mot').v, 4);
  assert.equal(scoreOf('他坚持了但没有重新验证。', 'grit').v, 4);
  assert.equal(scoreOf('他接受了反馈但没有采纳。', 'open').v, 4);
  assert.equal(scoreOf('他采纳了客户反馈但没有接受批评。', 'open').v, 4);
  assert.equal(scoreOf('他独立定位了故障但没有交付。', 'prof').v, 4);
  assert.equal(scoreOf('他主动整理成文档但没有形成例行。', 'mot').v, 5);
  assert.equal(scoreOf('他主动推进并形成了例行但没整理成文档。', 'mot').v, 5);
});
