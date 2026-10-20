import { ActiveSessionsList } from './ActiveSessionsList';
import { RtmsControls } from '@/components/RtmsControls';

export const dynamic = 'force-dynamic';

export default function LivePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Live meetings</h1>
        <p className="mt-1 text-sm text-ink-500">
          Active RTMS sessions. Click into one to see the transcript stream in real time.
        </p>
      </header>
      <RtmsControls />
      <ActiveSessionsList />
    </div>
  );
}
