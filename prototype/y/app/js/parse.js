/* 脚本化的「整理」：从原话里找人、找项目，拆出情境 / 行为 / 影响（SBI），只给涉及的维度打建议分。
   预置规则模拟模型输出，桌面记录、手机快速记录和导师评价共用。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store;

  const RULES = [
    { d: 'mot', re: /(主动|认领|没等|自己发起|自己拉|主动约|自己查)/, v: 4, up: /(带动|形成|例行|整理成文档|还整理)/ },
    { d: 'wis', re: /(方案|对比|取舍|缩小范围|先.{1,8}再|拆成|最小验证|讲清)/, v: 4, down: /(靠试|一个个试|没想清楚|直接改)/ },
    // 仅加班不能证明面对挫折时的坚持或调整，不生成坚毅力建议分。
    { d: 'grit', re: /(被否|被问住|受挫|坚持|没放弃|再访谈|又约|重新)/, v: 4 },
    { d: 'lead', re: /(带着|带新人|协调|帮.{1,6}(理清|熟悉)|组织大家|推动)/, v: 3 },
    { d: 'open', re: /(采纳|接受|听取|请教|按.{1,6}意见|客户反馈)/, v: 4 },
    { d: 'prof', re: /(独立|定位|上线|交付|处理了|写了复盘|故障|口径)/, v: 3, up: /(独立.{0,8}(故障|定位|处理)|一次完成|零回滚)/ },
  ];
  const TAGS = [['方案对比', /方案|对比/], ['主动推进', /主动|认领/], ['任务拆解', /拆/], ['需求变更', /需求.{0,4}(改|变)/], ['线上故障', /故障/], ['跨团队协作', /协调|对齐|跨/],
    ['客户现场', /客户/], ['故障定位', /定位|排查/], ['导师带教', /带新人|熟悉|带教/], ['复盘习惯', /复盘/]];
  const NEG = /(没有?|未|不|别)$/;
  const UNKNOWN_NOTE = { grit: '受挫后的反应待补充', mot: '主动还是被安排，待补充', wis: '判断与取舍待补充', prof: '具体做了什么、结果如何，待补充' };

  // 引用对齐到分句：从命中词所在分句的开头取到分句末尾，不以标点开头，也不在词中间截断；分句太长时两端标「…」
  const CLAUSE_END = /[，。；！？、\n,.;!?]/;
  const QUOTE_MAX = 30;
  function snippet(text, m) {
    let a = m.index, b = m.index + m[0].length;
    while (a > 0 && !CLAUSE_END.test(text[a - 1])) a -= 1;
    while (b < text.length && !CLAUSE_END.test(text[b])) b += 1;
    let s = text.slice(a, b).trim();
    if (s.length <= QUOTE_MAX) return s;
    const at = m.index - a;
    const from = Math.max(0, Math.min(at - 6, s.length - QUOTE_MAX));
    return `${from > 0 ? '…' : ''}${s.slice(from, from + QUOTE_MAX)}${from + QUOTE_MAX < s.length ? '…' : ''}`;
  }
  function shape(text, pid) {
    const p = st.person(pid);
    const clean = text.replace(new RegExp(`^${p.name}`), '').replace(/^(今天|这周|昨天|上周)/, '');
    const parts = clean.split(/[。！？；\n]/).map((s) => s.trim()).filter(Boolean);
    let bg = '', act = '', res = '';
    // 三句及以上：首句是情境，末句是影响，其余是行为；两句：先行为后影响；一句：只有行为，情境和影响待补充
    // 首句本身写了具体行为时，它归行为，情境留给本人补充
    if (parts.length >= 3) {
      const lead = RULES.some((r) => r.re.test(parts[0]));
      bg = lead ? '' : parts[0]; act = parts.slice(lead ? 0 : 1, -1).join('，'); res = parts[parts.length - 1];
    } else if (parts.length === 2) { act = parts[0]; res = parts[1]; }
    else act = parts[0] || clean;
    const titleSrc = (act || bg).replace(new RegExp(`^${p.name}`), '').replace(/^[，、]/, '');
    const title = titleSrc.length > 24 ? `${titleSrc.slice(0, 24)}…` : titleSrc;
    // 只写「参与了……」不算具体行为：抹成等长空白再匹配，引用位置仍对得上原话
    const acts = text.replace(/参与了?[^，。；！？\n]{0,16}/g, (x) => ' '.repeat(x.length));
    const scores = [];
    RULES.forEach((r) => {
      const all = [...acts.matchAll(new RegExp(r.re.source, 'g'))];
      const m = all.find((x) => !NEG.test(acts.slice(Math.max(0, x.index - 3), x.index)));
      if (m) {
        let v = r.v;
        if (r.up && r.up.test(acts)) v += 1;
        if (r.down && r.down.test(acts)) v = 2;
        scores.push({ p: pid, d: r.d, v, ai: v, st: 'ai', note: `锚点 ${v} · 引用「${snippet(text, m)}」` });
      } else if (all.length) {
        // 「没有主动推进」这类否定说法：不当正向证据，也不当反向证据，留给人判断
        scores.push({ p: pid, d: r.d, v: null, st: 'unknown', note: '原话为否定说法，待补充具体行为' });
      } else if (r.d === 'grit' || (r.d === 'prof' && !scores.some((x) => x.v != null))) {
        scores.push({ p: pid, d: r.d, v: null, st: 'unknown', note: UNKNOWN_NOTE[r.d] });
      }
    });
    const tags = TAGS.filter(([, re]) => re.test(text)).map(([t]) => t).slice(0, 4);
    const cand = /客户/.test(text) && /(说法|看不懂|场景|再访谈)/.test(text) ? ['客户视角'] : [];
    return { title, bg, act, res, scores, tags, cand };
  }
  function findPeople(text) {
    const vis = st.visiblePeople().slice().sort((a, b) => b.name.length - a.name.length);
    const hit = vis.filter((p) => text.includes(p.name));
    const hidden = st.people().filter((p) => !p.noReview && text.includes(p.name) && !hit.includes(p));
    return { hit, hidden };
  }
  function findProject(text) {
    return st.get().projects.find((p) => text.includes(p.name) || (p.id === 't-scene-b' && /分镜/.test(text)) || (p.id === 't-talk-a' && /口语/.test(text)) || (p.id === 'pr-hack' && /黑客松/.test(text)));
  }

  // 把整理好的草稿存成一条事件：没动过的 AI 建议分随保存一并确认并署名；改分与 AI 差 ≥ 2 且没写理由的，进 HR 校准队列。
  // d.pending：分数保持 AI 建议，留给后续逐项确认（导师评价）
  function commit(d) {
    const me = st.me();
    const scores = d.scores.map((s) => {
      if (s.v == null) return { p: d.pid, d: s.d, v: null, st: 'unknown', note: s.note };
      if (d.pending) return { p: d.pid, d: s.d, v: s.ai, ai: s.ai, st: 'ai', note: s.note };
      const edited = s.ai != null && s.v !== s.ai;
      const big = edited && Math.abs(s.v - s.ai) >= 2 && !s.why;
      return { p: d.pid, d: s.d, v: s.v, st: 'confirmed', ai: s.ai, by: me.id, note: s.note, bigGap: big || undefined,
        hist: [{ v: s.v, kind: edited ? 'edit' : 'confirm', by: me.id, at: NT.TODAY, why: s.why || '' }, ...(s.ai != null ? [{ v: s.ai, kind: 'ai', at: NT.TODAY }] : [])] };
    });
    const e = st.addEvent({ id: NT.uid('e'), kind: 'obs', date: d.date || NT.TODAY, project: d.proj?.id, recorder: me.id, people: [d.pid], review: d.review, title: d.title, bg: d.bg, act: d.act, res: d.res,
      srcs: [{ type: 'note', label: d.label || '一句话记录', loc: `${me.name} · ${NT.md(NT.TODAY)}`, quote: d.text }, ...(d.atts || [])], tags: d.tags || [], tagsAI: d.cand || [], scores });
    return { e, big: scores.filter((s) => s.bigGap).length };
  }

  NT.parse = { shape, findPeople, findProject, commit };
})();
