'use client';

import type { OrdinationEmailKind } from '@spsm/shared';
import { auth } from '@/lib/auth';

/** One file on a decision email, already read into base64. */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  /** Base64, no `data:` prefix. */
  content: string;
}

/** Roughly what `ordinationNotify` accepts, in bytes before base64. */
export const ATTACHMENTS_MAX_BYTES = 650_000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function fileToAttachment(file: File): Promise<EmailAttachment> {
  return {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    content: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
  };
}

/**
 * Sends a decision email through `ordinationNotify`. Who it goes to is the
 * Function's decision, read from the stored nomination; the reply says who.
 */
export async function sendDecisionEmail(input: {
  applicationId: string;
  kind: OrdinationEmailKind;
  subject: string;
  text: string;
  sentByName: string;
  attachments: EmailAttachment[];
}): Promise<string[]> {
  const user = auth().currentUser;
  if (!user) throw new Error('You are not signed in.');
  const token = await user.getIdToken();

  let response: Response;
  try {
    response = await fetch('/api/ordination/notify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Could not reach the church server. Check your connection and try again.');
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; to?: string[] };
  if (!response.ok) throw new Error(body.error || 'The email did not send. Please try again.');
  return body.to ?? [];
}
