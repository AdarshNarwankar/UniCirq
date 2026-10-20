import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUniversityEmailVerification, studentVerificationLabel } from '../src/lib/campus-verification';
import { seedState } from '../src/lib/seed';

const sample = seedState();
const campus = { ...sample.colleges[0], domain: 'dypiu.ac.in' };
const student = {
  ...sample.profiles[0],
  campus_verification_source: 'university_email' as const,
  campus_email_verified_at: '2026-10-20T05:30:00.000Z',
};

test('automatic DYPIU badge reflects server verification evidence and the matching selected campus', () => {
  assert.equal(hasUniversityEmailVerification(student, campus), true);
  assert.equal(studentVerificationLabel(student, campus), 'DYPIU email verified');
  assert.equal(hasUniversityEmailVerification(student, { ...campus, domain: 'DYPIU.AC.IN' }), true);
  assert.equal(hasUniversityEmailVerification(student, { ...campus, id: sample.colleges[1].id }), false);
  assert.equal(hasUniversityEmailVerification(student, { ...campus, domain: 'dypiu.ac.in.example' }), false);
  assert.equal(hasUniversityEmailVerification(student, undefined), false);
});

test('manual, unverified and non-student accounts retain their existing verification meaning', () => {
  assert.equal(hasUniversityEmailVerification({ ...student, campus_verification_source: null }, campus), false);
  assert.equal(studentVerificationLabel(sample.profiles[0], campus), 'Campus verified');
  assert.equal(studentVerificationLabel(sample.profiles[0], campus, 'Verified student'), 'Verified student');
  assert.equal(hasUniversityEmailVerification({ ...student, verified: false }, campus), false);
  assert.equal(hasUniversityEmailVerification({ ...student, role: 'business' }, campus), false);
  assert.equal(hasUniversityEmailVerification({ ...student, role: 'admin' }, campus), false);
});
