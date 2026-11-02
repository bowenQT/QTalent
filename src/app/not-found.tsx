import { State } from '@/components/ui/State';
export default function NotFound() {
  return (
    <main className="nt-login">
      <State title="页面链接失效" text="回到工作台重新进入。">
        <a className="n-btn" href="/work">
          回到工作台
        </a>
      </State>
    </main>
  );
}
