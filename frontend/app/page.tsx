import Link from 'next/link';
import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Card, CardHeader, CardBody, Stat, Badge } from '@/components/Card';
import { RtmsControls } from '@/components/RtmsControls';
import { Tabs } from '@/components/Tabs';
import { AIActions } from '@/components/AIActions';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // External-browser onboarding: when the dashboard is opened in a regular
  // browser (not inside the Zoom client) AND there's no Zoom OAuth session
  // yet, redirect to the lightweight /install page so the first thing the
  // user sees is an "Authorize and Install" call to action — not a dashboard
  // they can't use. Inside the Zoom client (User-Agent contains "ZoomApps/")
  // we always render the dashboard.
  if (!(await isZoomClient()) && !(await hasZoomSession())) {
    redirect('/install');
  }

  let data;
  try {
    data = await api.getDashboard();
  } catch (err) {
    return (
      <ErrorState message={`Could not reach the Express API at /api/dashboard. Is the backend running on port 4000? (${(err as Error).message})`} />
    );
  }

  // Build the chatbot deep link server-side so we don't have to expose
  // ZOOM_BOT_JID to the browser via env or /config.js. If the bot JID is
  // missing, the button hides itself rather than rendering a broken link.
  const botJid     = process.env.ZOOM_BOT_JID || '';
  const deepLink   = botJid ? `https://zoom.us/launch/chat?jid=robot_${botJid}` : null;
  const showSignedInActions = await hasZoomSession();

  // The Overview tab content is exactly the original Dashboard body — no
  // changes to it. We just wrap the page in tabs so we can add a sibling
  // "AI Actions" tab without disturbing the existing experience.
  const overview = (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">
            Continuous Meeting Chat surface — context before, during, and after every meeting.
          </p>
        </div>
        {showSignedInActions && (
          <div className="flex items-center gap-2">
            {deepLink && (
              <a
                href={deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded bg-zoom text-white px-3 py-2 text-sm font-medium hover:bg-zoom-dark"
              >
                Open Chatbot in Zoom ↗
              </a>
            )}
            <a
              href="/auth/logout"
              className="inline-flex items-center rounded border border-ink-300 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
            >
              Sign out
            </a>
          </div>
        )}
      </header>

      {/* When this page loads inside the Zoom App's in-meeting panel, the SDK
          initializes and the user can start/stop RTMS. In a normal browser
          this card silently degrades to a hint. */}
      <RtmsControls />

      <section className="grid grid-cols-2 @md:grid-cols-4 gap-3 @md:gap-4">
        <Card><CardBody><Stat label="Open" value={data.tasks.open} hint="active tasks" /></CardBody></Card>
        <Card><CardBody><Stat label="In progress" value={data.tasks.inProgress} /></CardBody></Card>
        <Card><CardBody><Stat label="Completed" value={data.tasks.completed} /></CardBody></Card>
        <Card>
          <CardBody>
            <Stat label="Pending review" value={data.pendingSuggestionCount} hint="AI-extracted, awaiting approval" />
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 @2xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            title="Recent meetings"
            subtitle="Continuous Meeting Chat keeps these accessible after they end"
          />
          <CardBody className="divide-y divide-ink-200 -mx-5 -my-4">
            {data.recentMeetings.map(m => (
              <Link
                key={m.id}
                href={`/meetings/${encodeURIComponent(m.id)}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-ink-50"
              >
                <div>
                  <div className="text-sm font-medium text-ink-900">{m.title}</div>
                  <div className="text-xs text-ink-500 mt-0.5">{formatDate(m.date)}</div>
                </div>
                {m.hasSummary
                  ? <Badge tone="ai">AI summary ready</Badge>
                  : <Badge>No summary</Badge>}
              </Link>
            ))}
            {data.recentMeetings.length === 0 && (
              <div className="px-5 py-6 text-sm text-ink-500">No meetings yet.</div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Next actions"
            subtitle="What you can do right now"
          />
          <CardBody className="space-y-3">
            <ActionLink
              href="/suggestions"
              title={`Review ${data.pendingSuggestionCount} AI-suggested tasks`}
              description="Approve, edit, or reject each one. Approved tasks become real Zoom Tasks."
            />
            <ActionLink
              href="/tasks"
              title={`Track ${data.tasks.open + data.tasks.inProgress} open tasks`}
              description="See ownership, due dates, and source meetings."
            />
            <ActionLink
              href="/changes"
              title="See what changed since the last meeting"
              description="New decisions, completed work, fresh risks."
            />
          </CardBody>
        </Card>
      </section>

      <section className="text-xs text-ink-500">
        Frontend: Next.js {process.env.NEXT_PUBLIC_VERSION ?? ''} • API proxied to Express on :4000.
        Set OPENAI_API_KEY in the backend env to enable live AI extraction.
      </section>
    </div>
  );

  return (
    <Tabs
      initialTabId="overview"
      tabs={[
        { id: 'overview',   label: 'Overview',   content: overview },
        { id: 'ai-actions', label: 'AI Actions', badge: <Badge tone="ai">New</Badge>, content: <AIActions /> },
      ]}
    />
  );
}

function ActionLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="block rounded border border-ink-200 px-4 py-3 hover:border-zoom hover:bg-zoom/5 transition">
      <div className="text-sm font-medium text-ink-900">{title}</div>
      <div className="text-xs text-ink-500 mt-0.5">{description}</div>
    </Link>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="text-sm font-semibold text-rose-700">Backend not reachable</h2>
        <p className="mt-1 text-sm text-ink-700">{message}</p>
        <pre className="mt-3 text-xs text-ink-500 bg-ink-50 rounded p-3 overflow-x-auto">npm run dev   # in the project root, in another terminal</pre>
      </CardBody>
    </Card>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── External-browser detection (SSR-only) ────────────────────────────────────

/**
 * The Zoom desktop/mobile client embeds a webview whose User-Agent contains
 * `ZoomApps/<version>`. Match on that. Misses only contrived browser UAs
 * that happen to spell out the same token.
 */
async function isZoomClient() {
  const h  = await headers();
  const ua = h.get('user-agent') ?? '';
  return /ZoomApps\//i.test(ua);
}

/**
 * Heuristic: does the browser have an Express session cookie?
 *
 * This is intentionally a passive cookie-presence check rather than an
 * SSR-side /auth/status fetch. Hitting Express from a Server Component
 * forwards a Set-Cookie back to the browser through Next.js, which
 * conflicts with the cookies set by the real proxied requests in the
 * OAuth round-trip — that race was the cause of the "Invalid state" loop.
 *
 * Trade-off: a user with a session cookie but no zoomTokens (e.g., they
 * visited /install once, closed the tab, came back) sees the dashboard
 * with no data rather than the install page. /install itself handles the
 * truly-not-signed-in case correctly, so the dashboard's own empty-state
 * is a fine degraded UX for a sample app.
 */
async function hasZoomSession() {
  const c = await cookies();
  return Boolean(c.get('connect.sid')?.value);
}
