/* 我的：当前身份、去桌面版、重置演示数据。手机端只有导师视角。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount } = NT;

  NT.mshell({
    tab: 'me', title: '我的',
    view: () => '我的',
    render,
  });

  function render(main) {
    const role = st.role(), me = st.me();
    mount(main, html`
      <div class="m-card">${UI.person(me.id, { size: 'lg', link: false, meta: `${st.roles[role].label} · ${me.title}`, meta2: st.roles[role].scope })}</div>
      <h3 class="m-h">更多</h3>
      <ul class="m-list">
        ${M.row('../app/index.html?as=mentor', icon('home'), '打开桌面版', '所带学员的档案、复盘和课题在桌面查看')}
        ${M.row('../../index.html', icon('book'), '评审导览', '两个版本的入口与怎么写评论')}
        <li><button class="m-row m-rolebtn" type="button" id="reset">${icon('retry')}<span>重置演示数据<small>只清本浏览器里的演示状态，评论不受影响</small></span><span></span></button></li>
      </ul>`);
    main.onclick = (e) => { if (e.target.closest('#reset')) NT.resetDemo(); };
  }
})();
