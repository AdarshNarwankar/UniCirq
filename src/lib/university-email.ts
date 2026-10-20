// This allowlist identifies campus mailboxes; typed addresses are never proof.
export const DYPIU_EMAIL_DOMAIN = 'dypiu.ac.in';
export type UniversityEmailProof = { userId: string; email: string; method: 'email_code' | 'google_workspace' };

export function dypiuMailbox(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^@\s]+@dypiu\.ac\.in$/.test(email) ? email : null;
}

// These claims must come from Better Auth's validated provider profile, never a
// sign-in request body. Non-Workspace Google accounts need a fresh mailbox code.
export function googleUniversityMailbox(profile: Record<string, unknown> | undefined, userEmail: unknown): string | null {
  const email = dypiuMailbox(userEmail);
  return email && profile?.email_verified === true && profile.hd === DYPIU_EMAIL_DOMAIN && dypiuMailbox(profile.email) === email ? email : null;
}
