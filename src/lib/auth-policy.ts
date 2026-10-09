import type { Profile } from './domain';
// These helpers consume a profile loaded from a verified server session.
export const needsUniversity = (profile: Pick<Profile, 'role' | 'college_id'>) => profile.role === 'student' && !profile.college_id;
export const roleDestination = (profile: Pick<Profile, 'role' | 'college_id'>) => needsUniversity(profile) ? '/onboarding' : '/' + profile.role;
