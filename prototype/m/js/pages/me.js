/* 我的：当前演示身份、员工本人的发展意愿、切换演示视角（模拟服务端按新身份重新过滤）、去桌面版、重置演示数据。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount } = NT;
  const ORDER = ['ceo', 'hrbp', 'lead', 'mentor', 'self'];

  NT.mshell({
    tab: 'me', title: '我的',
    view: () => '我的 · 演示视角',
    render,
  });

  function render(main) {
    const role = st.role(), me = st.me();
    mount(main, html`
      <div class="m-card">${UI.person(me.id, { size: 'lg', link: false, meta: `${st.roles[role].label} · ${me.title}`, meta2: st.roles[role].scope })}</div>
      ${role === 'self' ? html`<div id="mydir" style="margin-top:var(--s-3)">${UI.directionBlock(me.id, { canWrite: 'self' })}</div>` : ''}
      <h3 class="m-h">演示视角</h3>
      <p class="nt-muted" style="margin:-4px 0 var(--s-2)">切换后整页按新身份重新加载。正式产品里权限由服务端判断，这里只是演示手段。</p>
      <ul class="m-list" role="radiogroup" aria-label="演示视角">${ORDER.map((r) => html`<li><button class="m-row m-rolebtn" type="button" role="radio" aria-checked="${r === role}" data-r="${r}">${UI.avatar(st.roles[r].person, 'sm')}<span>${st.person(st.roles[r].person).name} · ${st.roles[r].label}<small>${st.roles[r].scope}</small></span>${r === role ? icon('check') : html`<span></span>`}</button></li>`)}</ul>
      <h3 class="m-h">更多</h3>
      <ul class="m-list">
        ${M.row('../app/index.html', icon('home'), '打开桌面版', '盘点、象限校准、项目找人在桌面完成')}
        ${M.row('../index.html', icon('book'), '评审导览', '四条叙事与怎么写评论')}
        <li><button class="m-row m-rolebtn" type="button" id="reset">${icon('retry')}<span>重置演示数据<small>只清本浏览器里的演示状态，评论不受影响</small></span><span></span></button></li>
      </ul>`);
    // 员工可以随时写下或修改本人的发展意愿；旧的记录保留
    const dir = NT.$('#mydir');
    if (dir) UI.wireDirection(dir, me.id, () => mount(dir, UI.directionBlock(me.id, { canWrite: 'self' })));
    main.onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (b && b.dataset.r !== role) { st.setRole(b.dataset.r); const u = new URL(location.href); u.searchParams.set('as', b.dataset.r); location.href = u.toString(); }
      if (e.target.closest('#reset')) NT.resetDemo();
    };
  }
})();
