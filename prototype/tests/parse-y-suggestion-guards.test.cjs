'use strict';

// 版本 Y：否定说法、单纯受挫和议程「先过…再过」不生成建议分。版本 X 不在此文件。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function shape(name, text) {
  const source = fs.readFileSync(path.join(__dirname, '../y/app/js/parse.js'), 'utf8');
  const NT = { store: { person: () => ({ name }) } };
  vm.runInNewContext(source, { window: { NT } }, { filename: 'prototype/y/app/js/parse.js' });
  return NT.parse.shape(text, 'demo');
}

function dim(name, text, d) {
  return shape(name, text).scores.find((s) => s.d === d);
}

function expectUnknown(name, text, d) {
  const row = dim(name, text, d);
  assert.ok(row, `${d} 应保留资料不足`);
  assert.equal(row.v, null);
  assert.equal(row.st, 'unknown');
  assert.equal(row.ai, undefined);
}

function expectScore(name, text, d, v) {
  const row = dim(name, text, d);
  assert.ok(row, `${d} 应有建议分`);
  assert.equal(row.v, v);
  assert.equal(row.ai, v);
  assert.equal(row.st, 'ai');
}

test('没有主动认领不给出内生动力分', () => {
  expectUnknown('林知远', '林知远没有主动认领这个任务。', 'mot');
});

test('没能独立定位故障不给出专业度分', () => {
  expectUnknown('林知远', '他没能独立定位故障。', 'prof');
});

test('只写方案被否不给出坚毅力分，方案本身仍可建议智慧力', () => {
  expectUnknown('林知远', '方案被否了。', 'grit');
  expectScore('林知远', '方案被否了。', 'wis', 4);
});

test('重新设计项目首页不单独给出坚毅力分', () => {
  expectUnknown('林知远', '他重新设计了项目首页。', 'grit');
});

test('主动推进仍是 4 分，被否定的形成方法不加到 5 分', () => {
  expectScore('林知远', '他主动推进，但没有形成方法。', 'mot', 4);
  expectScore('林知远', '他主动推进并形成了方法。', 'mot', 5);
});

test('先过再过的议程不生成智慧力分', () => {
  assert.equal(dim('林知远', '先过口语搭子一组，再过分镜二组。', 'wis'), undefined);
  assert.equal(dim('林知远', '先过一组，再过二组。', 'wis'), undefined);
});

test('受挫后复盘并重新验证仍建议坚毅力 4 分', () => {
  expectScore('林知远', '林知远在方案受挫后主动复盘，重新验证了方案。', 'grit', 4);
});

test('麦克风演示句仍建议内生动力 4 分', () => {
  const text = '结营前一周组员都在等分工。孟逸尘主动把任务池同步给了全组，下午组员就接上了。分工清楚多了，演示前一天全部跑通。';
  expectScore('孟逸尘', text, 'mot', 4);
});

test('先画接口图再对齐仍建议智慧力 4 分', () => {
  expectScore('周初晴', '周初晴这周先画了接口图，再去找后端对齐', 'wis', 4);
});

test('先列清单再排查仍建议智慧力，没等安排仍建议内生动力', () => {
  const text = '孟逸尘这周主动认领了结营演示的联调，先把问题列成清单再逐个排查，演示前一天全部跑通。';
  expectScore('孟逸尘', text, 'wis', 4);
  expectScore('林知远', '林知远没等安排就自己开始了。', 'mot', 4);
});

test('独立定位故障仍可升到专业度 4 分，否定后的主动行为仍可建议', () => {
  expectScore('林知远', '他独立定位了故障。', 'prof', 4);
  expectScore('林知远', '他没有休息就主动提出方案。', 'mot', 4);
});

test('没想清楚并直接改仍把智慧力降到 2 分', () => {
  expectScore('林知远', '他拆成三步，但没想清楚，直接改了。', 'wis', 2);
});
