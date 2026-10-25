// Approved prototype SVG. Only the React-generated instance ID is interpolated.
export function brandSvg(id: string) {
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
        <path d="M20.5 17.5 C14 15.5 10 10.5 11 3.8 C13.4 9 18 11.6 24.5 12.6 Z" fill="#1b1e25"/>
        <path d="M43.5 17.5 C50 15.5 54 10.5 53 3.8 C50.6 9 46 11.6 39.5 12.6 Z" fill="#1b1e25"/>
        <!-- 耳朵：在脸后面，转轴贴着脸 -->
        <path class="ear ear-l" d="M16.5 22.8 C11.5 18.8 4.6 19.8 3 23.8 C5 27.8 12 28.8 16.5 27.8 Z" fill="url(#${id}-foil)" stroke="#1b1e25" stroke-width="2" stroke-linejoin="round"/>
        <path class="ear ear-r" d="M47.5 22.8 C52.5 18.8 59.4 19.8 61 23.8 C59 27.8 52 28.8 47.5 27.8 Z" fill="url(#${id}-foil)" stroke="#1b1e25" stroke-width="2" stroke-linejoin="round"/>
        <!-- 脸：流光 -->
        <path d="M32 11.5 C45.5 11.5 50.5 19.8 50.5 30.5 C50.5 45 44 55.2 32 55.2 C20 55.2 13.5 45 13.5 30.5 C13.5 19.8 18.5 11.5 32 11.5 Z" fill="url(#${id}-foil)" stroke="#1b1e25" stroke-width="2.2"/>
        <!-- 额前一撮墨 -->
        <path class="tuft" d="M26.6 12.4 C28.2 17.6 31.4 18.2 32.2 14.6 C33.4 17.6 36 17.4 37.6 12.6" fill="none" stroke="#1b1e25" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
        <!-- 腮红 -->
        <ellipse class="cheek" cx="19.6" cy="37.2" rx="2.7" ry="1.5" fill="#ffc2e0"/>
        <ellipse class="cheek" cx="44.4" cy="37.2" rx="2.7" ry="1.5" fill="#ffc2e0"/>
        <!-- 眼睛 -->
        <g class="ip-eyes">
          <g class="eye-open">
            <ellipse cx="25" cy="30.6" rx="2.7" ry="3.1" fill="#1b1e25"/><ellipse cx="39" cy="30.6" rx="2.7" ry="3.1" fill="#1b1e25"/>
            <circle class="eye-glint" cx="26" cy="29.3" r=".95" fill="#fff"/><circle class="eye-glint" cx="40" cy="29.3" r=".95" fill="#fff"/>
          </g>
          <g class="eye-happy" fill="none" stroke="#1b1e25" stroke-width="2.3" stroke-linecap="round">
            <path d="M21.8 31.6 Q25 27.4 28.2 31.6"/><path d="M35.8 31.6 Q39 27.4 42.2 31.6"/>
          </g>
          <g class="eye-err" fill="none" stroke="#1b1e25" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22.4 28 L27 30.6 L22.4 33.2"/><path d="M41.6 28 L37 30.6 L41.6 33.2"/>
          </g>
        </g>
        <!-- 鼻口 -->
        <ellipse cx="32" cy="44.6" rx="12.4" ry="8.1" fill="#fff" stroke="#1b1e25" stroke-width="2"/>
        <ellipse class="nostril" cx="27.6" cy="43.4" rx="1.45" ry="2.1" fill="#1b1e25"/>
        <ellipse class="nostril" cx="36.4" cy="43.4" rx="1.45" ry="2.1" fill="#1b1e25"/>
        <g class="mouth" fill="none" stroke="#1b1e25" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path class="m-rest" d="M29.6 48.6 Q32 50.4 34.4 48.6"/>
          <path class="m-done" d="M28.6 47.9 Q32 53 35.4 47.9 Z" fill="#1b1e25"/>
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
      <circle cx="56" cy="8" r="7.5" fill="#1b1e25" stroke="#fff" stroke-width="1.5"/>
      <g class="q"><path d="M53.6 6.1 C53.7 4.3 55 3.4 56.2 3.4 C57.7 3.4 58.7 4.4 58.7 5.7 C58.7 7.6 56.3 7.7 56.3 9.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="56.3" cy="12" r="1" fill="#fff"/></g>
    </g>
    <g class="fx fx-error"><path d="M12.5 11 C12.5 11 16.5 16 16.5 18.5 C16.5 20.4 14.7 22 12.5 22 C10.3 22 8.5 20.4 8.5 18.5 C8.5 16 12.5 11 12.5 11 Z" fill="#9ccbe8" stroke="#1b1e25" stroke-width="1.2"/></g>
    </svg>`;
}
