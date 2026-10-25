'use strict';

// 直接执行两个原型现有的解析脚本，不复制正则；所有姓名和输入均为虚构演示。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const versions = {
  X: '../app/js/parse.js',
  Y: '../y/app/js/parse.js',
};

function gritFrom(version, originalText) {
  const source = fs.readFileSync(path.join(__dirname, versions[version]), 'utf8');
  const NT = { store: { person: () => ({ name: '林知远' }) } };
  vm.runInNewContext(source, { window: { NT } }, { filename: versions[version] });
  return NT.parse.shape(originalText, 'demo-lin').scores.find((score) => score.d === 'grit');
}

for (const version of Object.keys(versions)) {
  test(`版本 ${version}：仅有加班事实时不给出坚毅力分数`, () => {
    const result = gritFrom(version, '林知远今天加班到深夜。');
    assert.equal(result.v, null);
    assert.equal(result.st, 'unknown');
    assert.equal(result.ai, undefined);
  });

  test(`版本 ${version}：加班加其他模糊事实仍不生成坚毅力分数`, () => {
    const result = gritFrom(version, '林知远加班三个小时后参加项目讨论。');
    assert.equal(result.v, null);
    assert.equal(result.st, 'unknown');
  });

  test(`版本 ${version}：有受挫后复盘和再次验证的行为仍产生候选建议`, () => {
    const result = gritFrom(version, '林知远在方案受挫后主动复盘，重新验证了方案。');
    assert.equal(result.v, 4);
    assert.equal(result.ai, 4);
    assert.equal(result.st, 'ai');
  });

  test(`版本 ${version}：普通事件描述保持资料不足状态`, () => {
    const result = gritFrom(version, '林知远今天参加了项目讨论。');
    assert.equal(result.v, null);
    assert.equal(result.st, 'unknown');
  });
}
