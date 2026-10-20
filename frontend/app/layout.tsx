import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { AppShell } from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zoom AI Task Workflows',
  description: 'RTMS + Continuous Meeting Chat + AI task extraction sample',
};

/**
 * Explicit viewport config so embedded Zoom webviews don't apply mobile
 * default scaling. interactiveWidget=resizes-content keeps the meeting
 * Apps panel content adjusting cleanly when the side panel is dragged.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning on <body> only:
    //   Browser extensions (Dark Reader, Grammarly, etc.) frequently inject
    //   inline styles or attributes on <body> before React hydrates, which
    //   surfaces as a hydration mismatch in dev. The Zoom Apps SDK loaded
    //   with strategy="beforeInteractive" can also touch the document. This
    //   attribute suppresses the warning for the body element ONLY (children
    //   still validate normally) without changing runtime behavior.
    //   See: https://react.dev/reference/react-dom/client/hydrateRoot#suppressing-unavoidable-hydration-mismatch-errors
    <html lang="en">
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
        {/* Zoom Apps SDK — available on every page so client components can call
            zoomSdk.config({...}) and read getRunningContext() etc. */}
        <Script src="https://appssdk.zoom.us/sdk.min.js" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
