import { SuggestionsReview } from './SuggestionsReview';

export const dynamic = 'force-dynamic';

export default function SuggestionsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Suggested tasks</h1>
        <p className="mt-1 text-sm text-ink-500">
          AI extracted these from meeting transcripts. Nothing leaves this screen unless you approve it.
        </p>
      </header>
      <SuggestionsReview />
    </div>
  );
}
