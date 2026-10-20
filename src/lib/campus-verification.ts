import type { College, Profile } from './domain';

/** Display-only interpretation of the verification evidence returned by the server. */
export function hasUniversityEmailVerification(user: Profile, campus?: College): boolean {
  return user.role === 'student'
    && user.verified
    && user.campus_verification_source === 'university_email'
    && user.college_id === campus?.id
    && campus?.domain.toLowerCase() === 'dypiu.ac.in';
}

export function studentVerificationLabel(user: Profile, campus?: College, manualLabel = 'Campus verified'): string {
  return hasUniversityEmailVerification(user, campus) ? 'DYPIU email verified' : manualLabel;
}
