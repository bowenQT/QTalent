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
  // 否定只盖住紧挨着的那个说法，不把同一句里另外的行为一起抹掉。
  // 「特别」里的「别」不算否定。「但 / 不过 / 而 / 又」后面的说法另算。
  // 「方案 / 故障」这种词只有在同一句里没有别的正向行为时，才跟着被否定的说法一起不出分。
  const NEG_TAIL = /(?:没有?|没能|未能?|并非|不|别)(?:太|够|能|会|是|必|算|怎么|很)*$/;
  const CLAUSE_SEPS = ['，', '。', '；', '！', '？', '、', '\n', ',', ';', '但是', '不过', '然而', '可是', '但'];
  const RESTART = /[而又还并但只才再后的]/;
  const WEAK_WORD = new Set(['方案', '故障', '口径']);
  function clauseFrom(text, index) {
    let from = 0;
    for (const sep of CLAUSE_SEPS) {
      const i = text.lastIndexOf(sep, index - sep.length);
      if (i >= 0 && i + sep.length > from) from = i + sep.length;
    }
    return from;
  }
  function rawNegated(text, index) {
    const tail = text.slice(clauseFrom(text, index), index).slice(-8);
    const m = tail.match(NEG_TAIL);
    if (!m) return false;
    return !(m[0].startsWith('别') && text[index - m[0].length - 1] === '特');
  }
  // 被否定的词再往后只带紧挨着的下一个词，例如「没有独立定位」。中间有「而 / 又 / 的」就断开。
  function boundNegatives(text, matches) {
    const flags = matches.map((m) => rawNegated(text, m.index));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < matches.length; i++) {
        if (flags[i]) continue;
        for (let j = 0; j < i; j++) {
          if (!flags[j] || clauseFrom(text, matches[j].index) !== clauseFrom(text, matches[i].index)) continue;
          const gap = text.slice(matches[j].index + matches[j][0].length, matches[i].index);
          if (gap.length <= 2 && !RESTART.test(gap)) { flags[i] = true; changed = true; }
        }
      }
    }
    return flags;
  }
  const UNKNOWN_NOTE = { grit: '原话没写受挫后的反应', mot: '没写是主动还是被安排', wis: '原话里没有判断与取舍', prof: '没写具体做了什么、结果如何' };

  function snippet(text, m) {
    const i = Math.max(0, m.index - 4), s = text.slice(i, m.index + m[0].length + 8).replace(/[，。；\s]+$/, '');
    return s.length > 18 ? `${s.slice(0, 18)}…` : s;
  }
  function shape(text, pid) {
    const p = st.person(pid);
    const clean = text.replace(new RegExp(p.name, 'g'), '他').replace(/^(今天|这周|昨天|上周)/, '');
    const parts = clean.split(/[。！？；\n]/).map((s) => s.trim()).filter(Boolean);
    let bg = '', act = '', res = '';
    if (parts.length >= 3) { bg = parts[0]; act = parts.slice(1, -1).join('，'); res = parts[parts.length - 1]; }
    else if (parts.length === 2) { bg = parts[0]; act = parts[1]; }
    else act = parts[0] || clean;
    const titleSrc = (act || bg).replace(/^[他她]/, '').replace(/^[，、]/, '');
    const title = titleSrc.length > 24 ? `${titleSrc.slice(0, 24)}…` : titleSrc;
    // 只写「参与了……」不算具体行为：抹成等长空白再匹配，引用位置仍对得上原话
    const acts = text.replace(/参与了?[^，。；！？\n]{0,16}/g, (x) => ' '.repeat(x.length));
    const scores = [];
    RULES.forEach((r) => {
      const all = [...acts.matchAll(new RegExp(r.re.source, 'g'))];
      const downs = r.down ? [...acts.matchAll(new RegExp(r.down.source, 'g'))] : [];
      const ups = r.up ? [...acts.matchAll(new RegExp(r.up.source, 'g'))] : [];
      const baseNeg = boundNegatives(acts, all);
      const downNeg = downs.map((x) => rawNegated(acts, x.index));
      const upNeg = boundNegatives(acts, ups);
      const weakOff = all.map((x, i) => {
        if (baseNeg[i] || !WEAK_WORD.has(x[0])) return false;
        const start = clauseFrom(acts, x.index);
        const positiveVerb = all.some((o, j) => !baseNeg[j] && !WEAK_WORD.has(o[0]) && clauseFrom(acts, o.index) === start);
        const affirmedDown = downs.some((o, j) => !downNeg[j] && clauseFrom(acts, o.index) === start);
        const negatedNear = baseNeg.some((f, j) => f && clauseFrom(acts, all[j].index) === start)
          || downNeg.some((f, j) => f && clauseFrom(acts, downs[j].index) === start);
        return negatedNear && !positiveVerb && !affirmedDown;
      });
      const m = all.find((x, i) => !baseNeg[i] && !weakOff[i]);
      const downLive = downs.find((x, i) => !downNeg[i]);
      const upHit = upNeg.some((f) => !f);
      if (m || (downLive && all.length)) {
        let v = r.v;
        if (upHit) v += 1;
        if (downLive) v = 2;
        const quote = m || downLive;
        scores.push({ p: pid, d: r.d, v, ai: v, st: 'ai', note: `锚点 ${v} · 引用「${snippet(text, quote)}」` });
      } else if (all.length) {
        // 「没有主动推进」这类否定说法：不当正向证据，也不当反向证据，留给人判断
        scores.push({ p: pid, d: r.d, v: null, st: 'unknown', note: '原话是否定说法，不据此出分' });
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
    return st.get().projects.find((p) => text.includes(p.name) || (p.id === 'pr-ticket' && /工单/.test(text)) || (p.id === 'pr-kb' && /知识库|客服/.test(text)) || (p.id === 'pr-attrib' && /投放|归因/.test(text)) || (p.id === 'pr-recall' && /召回/.test(text)) || (p.id === 'pr-search' && /海外.{0,2}搜索/.test(text)));
  }

  // 把整理好的草稿存成一条事件：没动过的 AI 建议分随保存一并确认并署名；改分与 AI 差 ≥ 2 且没写理由的，进 HRBP 校准队列。
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
    const e = st.addEvent({ id: NT.uid('e'), kind: 'obs', date: d.date || NT.TODAY, project: d.proj?.id, recorder: me.id, people: [d.pid], title: d.title, bg: d.bg, act: d.act, res: d.res,
      srcs: [{ type: 'note', label: d.label || '一句话记录', loc: `${me.name} · ${NT.md(NT.TODAY)}`, quote: d.text }, ...(d.atts || [])], tags: d.tags || [], tagsAI: d.cand || [], scores });
    return { e, big: scores.filter((s) => s.bigGap).length };
  }

  NT.parse = { shape, findPeople, findProject, commit };
})();
