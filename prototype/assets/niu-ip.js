/* Niu-Talent IP 形象：小犇
   用法：NiuIP.mount(el, { state: 'rest', size: 64 })
         NiuIP.setState(el, 'done')
   状态：rest 静止（基础形态，不算在六种状态内）
         listening 倾听 / searching 检索 / thinking 思考 / done 完成 / confirm 需要你确认 / error 出错
   尺寸：≥ 48 完整形态；28–47 去掉腮红与额前墨；≤ 27 只保留脸、角和眼睛，特效只留确认角标 */
(function () {
  // 六种状态的动画规范，设计系统页面直接读取这里渲染规范表，避免两处不一致
  const SPEC = {
    listening: {
      name: '倾听',
      when: '输入框获得焦点、按住说话、录音进行中',
      motion: '身体轻微呼吸；双耳交替竖起；右侧两道声波依次亮起',
      timing: '呼吸 2.4s · 耳朵 2.4s · 声波 1.4s，in-out',
      loop: '循环，直到输入结束',
      reduced: '静止，双耳竖起，声波常亮',
    },
    searching: {
      name: '检索',
      when: 'AI 在授权范围内检索人员、材料或证据',
      motion: '眼睛左右扫视；一颗靛色光点绕头一圈；耳朵随扫视方向轻抖',
      timing: '扫视 1.6s in-out · 光点 1.8s 线性',
      loop: '循环，检索步骤完成即切换',
      reduced: '静止，眼睛看向右侧，光点停在右上',
    },
    thinking: {
      name: '思考',
      when: 'AI 在整理、生成或打建议分',
      motion: '头微侧 4°，眼睛看向右上；三个气泡由小到大依次浮起；嘴抿成一条线',
      timing: '气泡 1.8s 依次延迟 0.3s · 侧头 320ms ease-out',
      loop: '循环，开始流式输出后切到静止',
      reduced: '静止，侧头与三个气泡同时显示',
    },
    done: {
      name: '完成',
      when: '任务完成、确认已落墨、证据已归档',
      motion: '原地一跳，落地时轻压；眼睛眯成弯月，张嘴笑；两颗星光弹出',
      timing: '跳跃 700ms spring · 星光 800ms，第二颗延迟 120ms',
      loop: '只播一次；保持 1.6s 后回到静止',
      reduced: '不跳，直接显示笑脸和星光',
    },
    confirm: {
      name: '需要你确认',
      when: '有待核对、待确认分数、待校准的事项',
      motion: '头向左歪 7°，轻轻上下点动；右上角出现墨色问号角标；嘴是一个小圆',
      timing: '点动 2.2s in-out',
      loop: '循环，直到事项被处理',
      reduced: '静止歪头，问号角标常显',
    },
    error: {
      name: '出错',
      when: '上传、转写、生成失败，或操作被权限拒绝',
      motion: '左右轻摇一下；眼睛变成 > <；耳朵耷拉；额角滑下一滴汗',
      timing: '摇头 500ms 一次 · 汗滴 1.8s ease-in',
      loop: '摇头只一次；汗滴循环，直到错误被处理',
      reduced: '不摇头，耳朵耷拉，汗滴静止',
    },
  };

  const STATES = Object.fromEntries(Object.entries(SPEC).map(([k, v]) => [k, v.name]));

  const CSS = `
  .ip { display:inline-block; position:relative; line-height:0; flex:none; }
  .ip svg { width:100%; height:100%; overflow:visible; }
  .ip .ip-body, .ip .ip-head, .ip .ip-eyes, .ip .ear, .ip .fx, .ip .fx * { transform-box: fill-box; transform-origin: center; }
  .ip .ip-body { transform-origin: 50% 92%; }
  .ip .ear-l { transform-origin: 100% 50%; }
  .ip .ear-r { transform-origin: 0% 50%; }

  /* 状态 → 部件显隐 */
  .ip .eye-happy, .ip .eye-err, .ip .fx,
  .ip .m-done, .ip .m-think, .ip .m-confirm, .ip .m-err { display:none; }
  .ip[data-state="done"] .eye-open, .ip[data-state="error"] .eye-open { display:none; }
  .ip[data-state="done"] .eye-happy, .ip[data-state="error"] .eye-err { display:inline; }
  .ip[data-state="done"] .m-rest, .ip[data-state="thinking"] .m-rest,
  .ip[data-state="confirm"] .m-rest, .ip[data-state="error"] .m-rest { display:none; }
  .ip[data-state="done"] .m-done, .ip[data-state="thinking"] .m-think,
  .ip[data-state="confirm"] .m-confirm, .ip[data-state="error"] .m-err { display:inline; }
  .ip[data-state="listening"] .fx-listen, .ip[data-state="searching"] .fx-search,
  .ip[data-state="thinking"] .fx-think, .ip[data-state="done"] .fx-done,
  .ip[data-state="confirm"] .fx-confirm, .ip[data-state="error"] .fx-error { display:inline; }

  /* 尺寸简化 */
  .ip[data-size="m"] .cheek, .ip[data-size="m"] .tuft { display:none; }
  .ip[data-size="s"] .cheek, .ip[data-size="s"] .tuft, .ip[data-size="s"] .mouth,
  .ip[data-size="s"] .nostril, .ip[data-size="s"] .eye-glint { display:none; }
  .ip[data-size="s"] .fx:not(.fx-confirm) { display:none !important; }
  .ip[data-size="s"] .fx-confirm .q { display:none; }

  /* 眨眼：静止、倾听、检索时 */
  .ip[data-state="rest"] .eye-open, .ip[data-state="listening"] .eye-open,
  .ip[data-state="searching"] .eye-open { animation: ip-blink 4.6s infinite; }
  @keyframes ip-blink { 0%,93%,100% { transform: scaleY(1); } 95% { transform: scaleY(.08); } }

  /* 倾听 */
  .ip[data-state="listening"] .ip-body { animation: ip-breathe 2.4s cubic-bezier(.65,0,.35,1) infinite; }
  @keyframes ip-breathe { 50% { transform: scale(1.03, .975); } }
  .ip[data-state="listening"] .ear-l { animation: ip-perk-l 2.4s cubic-bezier(.65,0,.35,1) infinite; }
  .ip[data-state="listening"] .ear-r { animation: ip-perk-r 2.4s cubic-bezier(.65,0,.35,1) infinite 1.2s; }
  @keyframes ip-perk-l { 0%,40%,100% { transform: rotate(0); } 20% { transform: rotate(14deg); } }
  @keyframes ip-perk-r { 0%,40%,100% { transform: rotate(0); } 20% { transform: rotate(-14deg); } }
  .ip .fx-listen path { opacity:0; animation: ip-wave 1.4s ease-in-out infinite; }
  .ip .fx-listen path:nth-child(2) { animation-delay: .2s; }
  @keyframes ip-wave { 30%,60% { opacity:1; } }

  /* 检索 */
  .ip[data-state="searching"] .ip-eyes { animation: ip-scan 1.6s cubic-bezier(.65,0,.35,1) infinite; }
  @keyframes ip-scan { 25% { transform: translateX(-2.4px); } 75% { transform: translateX(2.4px); } }
  .ip[data-state="searching"] .ear-l { animation: ip-flick-l 1.6s ease-in-out infinite; }
  .ip[data-state="searching"] .ear-r { animation: ip-flick-r 1.6s ease-in-out infinite; }
  @keyframes ip-flick-l { 25% { transform: rotate(8deg); } 75% { transform: rotate(0); } }
  @keyframes ip-flick-r { 25% { transform: rotate(0); } 75% { transform: rotate(-8deg); } }
  .ip .fx-search { transform-box: view-box; transform-origin: 32px 32px; animation: ip-orbit 1.8s linear infinite; }
  @keyframes ip-orbit { to { transform: rotate(360deg); } }

  /* 思考 */
  .ip[data-state="thinking"] .ip-head { transform: rotate(4deg); transition: transform .32s cubic-bezier(.2,.8,.2,1); }
  .ip[data-state="thinking"] .ip-eyes { transform: translate(1.6px, -1.8px); transition: transform .32s cubic-bezier(.2,.8,.2,1); }
  .ip .fx-think circle { opacity:0; animation: ip-bubble 1.8s ease-in-out infinite; }
  .ip .fx-think circle:nth-child(2) { animation-delay: .3s; }
  .ip .fx-think circle:nth-child(3) { animation-delay: .6s; }
  @keyframes ip-bubble { 20%,70% { opacity:1; } 100% { opacity:0; transform: translateY(-2px); } }

  /* 完成 */
  .ip[data-state="done"] .ip-body { animation: ip-hop .7s cubic-bezier(.2,.8,.2,1) 1; }
  @keyframes ip-hop { 40% { transform: translateY(-6px) scale(.97,1.04); } 72% { transform: translateY(0) scale(1.04,.96); } }
  .ip .fx-done path { animation: ip-spark .8s cubic-bezier(.2,.8,.2,1) both; }
  .ip .fx-done path:nth-child(2) { animation-delay: .12s; }
  @keyframes ip-spark { 0% { transform: scale(0) rotate(-45deg); opacity:0; } 60% { transform: scale(1.2); opacity:1; } 100% { transform: scale(1); opacity:1; } }

  /* 需要你确认 */
  .ip[data-state="confirm"] .ip-head { animation: ip-nod 2.2s cubic-bezier(.65,0,.35,1) infinite; }
  @keyframes ip-nod { 0%,100% { transform: rotate(-7deg); } 50% { transform: rotate(-7deg) translateY(-2px); } }
  .ip .fx-confirm { animation: ip-nudge 2.2s cubic-bezier(.65,0,.35,1) infinite; }
  @keyframes ip-nudge { 50% { transform: translateY(-2.5px); } }

  /* 出错 */
  .ip[data-state="error"] .ip-body { animation: ip-shake .5s ease-in-out 1; }
  @keyframes ip-shake { 20% { transform: translateX(-2.2px); } 40% { transform: translateX(2.2px); } 60% { transform: translateX(-1.5px); } 80% { transform: translateX(1px); } }
  .ip[data-state="error"] .ear-l { transform: rotate(-22deg); }
  .ip[data-state="error"] .ear-r { transform: rotate(22deg); }
  .ip .fx-error { animation: ip-drip 1.8s ease-in infinite; }
  @keyframes ip-drip { 0% { transform: translateY(-2px); opacity:0; } 30% { opacity:1; } 100% { transform: translateY(4px); opacity:0; } }

  .ip .ear { transition: transform .32s cubic-bezier(.2,.8,.2,1); }

  @media (prefers-reduced-motion: reduce) {
    .ip *, .ip .ip-body, .ip .ip-head, .ip .ip-eyes, .ip .ear { animation: none !important; transition: none !important; }
    .ip .fx-listen path, .ip .fx-think circle, .ip .fx-error { opacity: 1; }
    .ip[data-state="listening"] .ear-l { transform: rotate(14deg); }
    .ip[data-state="listening"] .ear-r { transform: rotate(-14deg); }
    .ip[data-state="searching"] .ip-eyes { transform: translateX(2.4px); }
    .ip[data-state="searching"] .fx-search { transform: rotate(45deg); }
    .ip[data-state="confirm"] .ip-head { transform: rotate(-7deg); }
  }`;

  function injectCss() {
    if (document.getElementById('niu-ip-css')) return;
    const s = document.createElement('style');
    s.id = 'niu-ip-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const INK = '#1b1e25';
  let uid = 0;

  function svg(id) {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="${id}-foil" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#dfe4ff"/><stop offset=".35" stop-color="#d4f2f6"/>
        <stop offset=".68" stop-color="#ebf8d8"/><stop offset="1" stop-color="#ffe4f2"/>
      </linearGradient>
    </defs>
    <g class="ip-body">
      <g class="ip-head">
        <!-- 牛角：墨，笔锋由粗到细 -->
        <path d="M20.5 17.5 C14 15.5 10 10.5 11 3.8 C13.4 9 18 11.6 24.5 12.6 Z" fill="${INK}"/>
        <path d="M43.5 17.5 C50 15.5 54 10.5 53 3.8 C50.6 9 46 11.6 39.5 12.6 Z" fill="${INK}"/>
        <!-- 耳朵：在脸后面，转轴贴着脸 -->
        <path class="ear ear-l" d="M16.5 22.8 C11.5 18.8 4.6 19.8 3 23.8 C5 27.8 12 28.8 16.5 27.8 Z" fill="url(#${id}-foil)" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
        <path class="ear ear-r" d="M47.5 22.8 C52.5 18.8 59.4 19.8 61 23.8 C59 27.8 52 28.8 47.5 27.8 Z" fill="url(#${id}-foil)" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
        <!-- 脸：流光 -->
        <path d="M32 11.5 C45.5 11.5 50.5 19.8 50.5 30.5 C50.5 45 44 55.2 32 55.2 C20 55.2 13.5 45 13.5 30.5 C13.5 19.8 18.5 11.5 32 11.5 Z" fill="url(#${id}-foil)" stroke="${INK}" stroke-width="2.2"/>
        <!-- 额前一撮墨 -->
        <path class="tuft" d="M26.6 12.4 C28.2 17.6 31.4 18.2 32.2 14.6 C33.4 17.6 36 17.4 37.6 12.6" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
        <!-- 腮红 -->
        <ellipse class="cheek" cx="19.6" cy="37.2" rx="2.7" ry="1.5" fill="#ffc2e0"/>
        <ellipse class="cheek" cx="44.4" cy="37.2" rx="2.7" ry="1.5" fill="#ffc2e0"/>
        <!-- 眼睛 -->
        <g class="ip-eyes">
          <g class="eye-open">
            <ellipse cx="25" cy="30.6" rx="2.7" ry="3.1" fill="${INK}"/><ellipse cx="39" cy="30.6" rx="2.7" ry="3.1" fill="${INK}"/>
            <circle class="eye-glint" cx="26" cy="29.3" r=".95" fill="#fff"/><circle class="eye-glint" cx="40" cy="29.3" r=".95" fill="#fff"/>
          </g>
          <g class="eye-happy" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round">
            <path d="M21.8 31.6 Q25 27.4 28.2 31.6"/><path d="M35.8 31.6 Q39 27.4 42.2 31.6"/>
          </g>
          <g class="eye-err" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22.4 28 L27 30.6 L22.4 33.2"/><path d="M41.6 28 L37 30.6 L41.6 33.2"/>
          </g>
        </g>
        <!-- 鼻口 -->
        <ellipse cx="32" cy="44.6" rx="12.4" ry="8.1" fill="#fff" stroke="${INK}" stroke-width="2"/>
        <ellipse class="nostril" cx="27.6" cy="43.4" rx="1.45" ry="2.1" fill="${INK}"/>
        <ellipse class="nostril" cx="36.4" cy="43.4" rx="1.45" ry="2.1" fill="${INK}"/>
        <g class="mouth" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path class="m-rest" d="M29.6 48.6 Q32 50.4 34.4 48.6"/>
          <path class="m-done" d="M28.6 47.9 Q32 53 35.4 47.9 Z" fill="${INK}"/>
          <path class="m-think" d="M30 49.4 L34.2 48.8"/>
          <circle class="m-confirm" cx="32" cy="49.2" r="1.3"/>
          <path class="m-err" d="M28.6 49.4 Q30.3 48 32 49.4 Q33.7 50.8 35.4 49.4"/>
        </g>
      </g>
    </g>
    <!-- 状态特效 -->
    <g class="fx fx-listen" fill="none" stroke="#3d55d6" stroke-width="2" stroke-linecap="round">
      <path d="M63 27 Q66 32 63 37"/><path d="M67.5 22.5 Q72.5 32 67.5 41.5"/>
    </g>
    <g class="fx fx-search"><circle cx="32" cy="0.5" r="2.6" fill="#3d55d6"/><circle cx="32" cy="63.5" r="1.6" fill="#6fd6e2"/></g>
    <g class="fx fx-think" fill="#3d55d6"><circle cx="52" cy="10" r="1.6"/><circle cx="57" cy="5" r="2.2"/><circle cx="62.5" cy="-0.5" r="2.9"/></g>
    <g class="fx fx-done" fill="#3d55d6">
      <path d="M57 0 L58.7 5.6 L64.3 7.3 L58.7 9 L57 14.6 L55.3 9 L49.7 7.3 L55.3 5.6 Z"/>
      <path d="M6 5 L6.9 7.6 L9.5 8.5 L6.9 9.4 L6 12 L5.1 9.4 L2.5 8.5 L5.1 7.6 Z" fill="#6fd6e2"/>
    </g>
    <g class="fx fx-confirm">
      <circle cx="56" cy="8" r="7.5" fill="${INK}" stroke="#fff" stroke-width="1.5"/>
      <g class="q"><path d="M53.6 6.1 C53.7 4.3 55 3.4 56.2 3.4 C57.7 3.4 58.7 4.4 58.7 5.7 C58.7 7.6 56.3 7.7 56.3 9.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="56.3" cy="12" r="1" fill="#fff"/></g>
    </g>
    <g class="fx fx-error"><path d="M12.5 11 C12.5 11 16.5 16 16.5 18.5 C16.5 20.4 14.7 22 12.5 22 C10.3 22 8.5 20.4 8.5 18.5 C8.5 16 12.5 11 12.5 11 Z" fill="#9ccbe8" stroke="${INK}" stroke-width="1.2"/></g>
    </svg>`;
  }

  function sizeClass(px) {
    return px >= 48 ? 'l' : px >= 28 ? 'm' : 's';
  }

  function mount(el, opts) {
    injectCss();
    const o = Object.assign({ state: 'rest', size: 64 }, opts || {});
    el.classList.add('ip');
    el.dataset.state = o.state;
    el.dataset.size = sizeClass(o.size);
    el.style.width = el.style.height = o.size + 'px';
    el.setAttribute('role', 'img');
    el.innerHTML = svg('ip' + (++uid));
    label(el);
    return el;
  }

  const timers = new WeakMap();
  function setState(el, state, opts) {
    clearTimeout(timers.get(el));
    if (el.dataset.state === state) {
      // 同一状态再次触发时重放一次性动画（完成、出错）
      el.dataset.state = '';
      void el.offsetWidth;
    }
    el.dataset.state = state;
    label(el);
    // 完成只播一次，保持 1.6s 后回到静止；调用方可以传 { hold: true } 保持
    if (state === 'done' && !(opts && opts.hold)) {
      timers.set(el, setTimeout(() => { el.dataset.state = 'rest'; label(el); }, 700 + 1600));
    }
  }

  function label(el) {
    const s = SPEC[el.dataset.state];
    el.setAttribute('aria-label', s ? `小犇：${s.name}` : '小犇');
  }

  window.NiuIP = { mount, setState, STATES, SPEC };
})();
