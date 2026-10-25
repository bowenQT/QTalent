import { State } from '@/components/ui/State';
export default function NotFound() {
  return (
    <main className="nt-login">
      <State title="页面链接失效" text="回到项目列表重新进入。">
        <a className="n-btn" href="/projects">
          回到项目列表
        </a>
      </State>
    </main>
  );
}
