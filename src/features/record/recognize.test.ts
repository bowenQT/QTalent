import { describe, expect, it } from 'vitest';
import { recognizePerson } from './recognize';
import type { PersonOption } from './types';

const person = (id: string, name: string): PersonOption => ({
  id,
  name,
  hue: 0,
  photo: null,
  orgShort: '演示组',
  demo: true,
});
const people = [
  person('a', '苏少卿'),
  person('b', '季思齐'),
  person('c', '王一'),
  person('d', '王一鸣'),
  person('e', '林同名'),
  person('f', '林同名'),
];

describe('recognizePerson', () => {
  it('原话里完整出现一位候选的姓名：认出这位', () => {
    expect(recognizePerson('今天苏少卿主动同步了进度', people)).toBe('a');
  });

  it('没出现、只出现半个名字：认不出', () => {
    expect(recognizePerson('今天大家都很积极', people)).toBeNull();
    expect(recognizePerson('少卿今天主动同步', people)).toBeNull();
  });

  it('同时出现两位：不替用户挑，认不出', () => {
    expect(recognizePerson('苏少卿和季思齐一起做完了', people)).toBeNull();
  });

  it('重名：不自动选，哪怕原话里还有别的人名', () => {
    expect(recognizePerson('林同名今天很投入', people)).toBeNull();
    expect(recognizePerson('林同名帮苏少卿改了稿', people)).toBeNull();
  });

  it('姓名互相包含：不自动选', () => {
    expect(recognizePerson('王一鸣今天主动补了测试', people)).toBeNull();
    expect(recognizePerson('王一今天主动补了测试', people)).toBe('c');
    expect(recognizePerson('王一和王一鸣一起完成了测试', people)).toBeNull();
  });

  it('长姓名重名、短姓名唯一：不退化成短姓名', () => {
    const twins = [
      person('c', '王一'),
      person('d1', '王一鸣'),
      person('d2', '王一鸣'),
    ];
    expect(recognizePerson('王一鸣今天补了测试', twins)).toBeNull();
  });

  it('单字姓名不参与自动选中，也不挡住别人', () => {
    const withSingle = [...people, person('one', '一')];
    expect(recognizePerson('今天一起完成了测试', withSingle)).toBeNull();
    expect(recognizePerson('苏少卿今天一起补了测试', withSingle)).toBe('a');
  });

  it('按字形和字母计数：组合 emoji、纯符号不算姓名', () => {
    const odd = [
      ...people,
      person('e1', '👍🏽'),
      person('e2', '👩‍💻'),
      person('e3', '一👍🏽'),
      person('e4', '★☆'),
    ];
    expect(recognizePerson('今天👍🏽👩‍💻一👍🏽★☆', odd)).toBeNull();
    expect(recognizePerson('苏少卿今天👍🏽', odd)).toBe('a');
  });

  it('同一位的姓名出现多次：仍是这一位', () => {
    expect(recognizePerson('苏少卿先改，苏少卿再测', people)).toBe('a');
  });

  it('候选为空或姓名为空：认不出', () => {
    expect(recognizePerson('苏少卿', [])).toBeNull();
    expect(recognizePerson('任何话', [person('x', ' ')])).toBeNull();
  });
});
