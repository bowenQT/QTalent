import { notFound } from 'next/navigation';
import { TalentSamples } from './TalentSamples';

// Sub-routes do not inherit the parent page's gate, so each one guards itself.
export default function TalentDesignSystem() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <TalentSamples />;
}
