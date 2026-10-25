import { Niu } from '@/components/brand/Niu';
import { LoginForm } from '@/features/auth/LoginForm';
export default function Login() {
  return (
    <main className="nt-login">
      <section className="n-card">
        <Niu size={48} />
        <h1>登录 Niu-Talent</h1>
        <LoginForm />
      </section>
    </main>
  );
}
