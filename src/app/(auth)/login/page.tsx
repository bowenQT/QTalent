import { Niu } from '@/components/brand/Niu';
import { LoginForm } from '@/features/auth/LoginForm';
import { safeEntryReturnTo } from '@/contracts/entry-links';
/** A deep link sends people here with `returnTo`; only a canonical deep link
 * survives, anything else (another site, `//host`, extra parameters) goes home. */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const next =
    returnTo === undefined ? '/work' : safeEntryReturnTo(returnTo);
  return (
    <main className="nt-login">
      <section className="n-card">
        <Niu size={48} />
        <h1>登录 Niu-Talent</h1>
        <LoginForm returnTo={next} />
      </section>
    </main>
  );
}
