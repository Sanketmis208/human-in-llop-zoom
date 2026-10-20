import { ACTIONS } from '../constants.js';
import { getWebviewUrl } from '../zoom/zoom-app-urls.js';

// Re-exported for callers that import getWebviewUrl from this module — keeps
// existing imports working without forcing churn elsewhere.
export { getWebviewUrl };

export function buildServiceMenuCard() {
  const dashboardUrl = getWebviewUrl();
  const sections = [];

  if (dashboardUrl) {
    // HTTPS URL available — show the Open Dashboard dialog button.
    sections.push(
      { type: 'message', text: 'Services Dashboard', style: { bold: true } },
      { type: 'message', text: 'View engagement metrics, including service launches, completed actions, submitted prompts, and recent activity.' },
      {
        type: 'actions',
        items: [
          {
            type: 'button',
            text: 'Open Dashboard',
            value: ACTIONS.OPEN_DASHBOARD,
            style: 'Default',
            action: 'dialog',
            dialog: {
              size: 'L',
              title: { text: 'AI Services Dashboard' },
              link: dashboardUrl,
            },
          },
        ],
      },
      { type: 'divider', style: { bold: false, dotted: false, color: '#98a0a9' } },
    );
  } else {
    // No HTTPS URL — Zoom would reject the dialog button. Show a hint instead so
    // local-only dev still works without breaking the rest of the menu.
    sections.push(
      { type: 'message', text: 'Services Dashboard', style: { bold: true } },
      { type: 'message', text: 'Set FRONTEND_PUBLIC_URL (or ZOOM_REDIRECT_URI) in .env to your ngrok https URL to enable the Open Dashboard button.' },
      { type: 'divider', style: { bold: false, dotted: false, color: '#98a0a9' } },
    );
  }

  sections.push(
    { type: 'message', text: 'Available services', style: { bold: true } },
    { type: 'message', text: 'Choose a service to get started.' },
    {
      type: 'actions',
      items: [
        { type: 'button', text: 'Create Task',        value: ACTIONS.START_CREATE_TASK, style: 'Primary' },
        { type: 'button', text: 'Research Assistant', value: ACTIONS.START_RESEARCH,    style: 'Primary' },
      ],
    },
  );

  return {
    settings: {},
    head: {
      text: 'Zoom Team Chat AI Services',
      sub_head: { text: 'Launch workplace AI services and track usage from the dashboard.' },
      style: { bold: true },
    },
    body: [{ type: 'section', layout: 'vertical', sections }],
  };
}

export function buildChannelWelcomeCard(channelName) {
  return {
    head: { text: 'Zoom Team Chat AI Services', style: { bold: true } },
    body: [
      {
        type: 'message',
        is_markdown_support: true,
        text: `Hello *${channelName}*! I've been added to this channel and I'm here to help.`,
      },
      {
        type: 'divider',
        style: { bold: false, dotted: false, color: '#98a0a9' },
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: '*Here is what I can help with:*',
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: '<color:#0E71EB|Research Assistant> — Ask questions, get AI-powered answers, and draft professional responses.',
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: '<color:#2E7D32|Create Task> — Capture a follow-up task into the AI Task Workflow dashboard.',
      },
      {
        type: 'divider',
        style: { bold: false, dotted: false, color: '#98a0a9' },
      },
      {
        type: 'message',
        text: 'Type "menu" at any time to see available services.',
      },
    ],
  };
}
