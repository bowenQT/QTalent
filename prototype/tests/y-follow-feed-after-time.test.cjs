'use strict';
const assert = require('node:assert/strict');
// 沙箱里返回的数组属于另一个 realm，先转成本地普通值再做深比较。
const plain = (value) => JSON.parse(JSON.stringify(value));
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// 直接加载 Y 的关注与动态函数；时间、人员与事件均为虚构数据。
const script = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const method = (name, args) => {
  const re = new RegExp('  store\\.' + name + ' = \\(' + args + '\\) => \\{[\\s\\S]*?\\n  \\};');
  const match = script.match(re);
  assert.ok(match, '找不到 Y 的真实方法 ' + name);
  return match[0];
};
const source = [method('follow', 'pid, via'), method('followFeed', 'pid')].join('\n');
const today = '2026-10-25';

function setup() {
  const S = { follows: [], actions: [], tracks: [] };
  const eventList = [];
  const recos = [];
  const NT = { TODAY: today };
  const store = {
    me: () => ({ id: 'manager-demo' }),
    canFollow: () => true,
    isFollowing: pid => S.follows.some(f => f.person === pid),
    followList: () => S.follows,
    visibleEvents: () => ({ events: eventList }),
    watch: () => [],
    can: () => true,
    recosFor: () => recos,
    person: id => ({ name: id }),
    fitText: dir => dir,
    save() {},
  };
  const DateMock = { now: () => 2000 };
  vm.runInNewContext(source, { S, NT, store, Date: DateMock }, { filename: 'Y/store.js' });
  return { S, store, eventList, recos };
}
function event(id, date, ts) {
  return { id, kind: 'obs', date, ts, title: id, recorder: 'mentor-demo', scores: [] };
}
test('Y：关注当天较早事件不再冒充新动态', () => {
  const f = setup();
  f.eventList.push(event('before', today, 1000), event('after', today, 3000));
  f.store.follow('p-demo');
  assert.equal(f.S.follows[0].ts, 2000);
  assert.deepEqual(plain(f.store.followFeed('p-demo').map(x => x.ev)), ['after']);
});
test('Y：较晚日期的动态正常出现，较早日期不出现', () => {
  const f = setup();
  f.eventList.push(event('yesterday', '2026-10-24', 9000), event('tomorrow', '2026-10-26', undefined));
  f.store.follow('p-demo');
  assert.deepEqual(plain(f.store.followFeed('p-demo').map(x => x.ev)), ['tomorrow']);
});
test('Y：同日没有精确时间的旧种子事件不推成新动态', () => {
  const f = setup();
  f.eventList.push(event('legacy-no-time', today), event('after', today, 3000));
  f.store.follow('p-demo');
  assert.deepEqual(plain(f.store.followFeed('p-demo').map(x => x.ev)), ['after']);
});
test('Y：旧关注记录没有关注 ts 时保留日期级兼容逻辑', () => {
  const f = setup();
  f.S.follows.push({ by: 'manager-demo', person: 'p-demo', at: today });
  f.eventList.push(event('legacy', today), event('old-timestamp', today, 1000));
  assert.deepEqual(plain(f.store.followFeed('p-demo').map(x => x.ev).sort()), ['legacy', 'old-timestamp']);
});
test('Y：行动、跟踪和推荐等不同来源也按关注时刻统一过滤', () => {
  const f = setup();
  f.S.actions.push(
    { person: 'p-demo', at: today, ts: 1000, title: 'before-action', state: 'todo' },
    { person: 'p-demo', at: today, ts: 3000, title: 'after-action', state: 'todo' },
  );
  f.S.tracks.push(
    { person: 'p-demo', since: today, ts: 1000, state: 'on', owner: 'manager-demo', q: 'before-track' },
    { person: 'p-demo', since: today, ts: 3000, state: 'on', owner: 'manager-demo', q: 'after-track' },
  );
  f.recos.push(
    { person: 'p-demo', verifiedAt: today, verifiedTs: 1000, by: 'mentor', verifiedBy: 'hr', dir: 'before-reco' },
    { person: 'p-demo', verifiedAt: today, verifiedTs: 3000, by: 'mentor', verifiedBy: 'hr', dir: 'after-reco' },
  );
  f.store.follow('p-demo');
  const texts = f.store.followFeed('p-demo').map(x => x.text);
  assert.equal(texts.length, 3);
  assert.ok(texts.every(x => x.includes('after-')));
});
