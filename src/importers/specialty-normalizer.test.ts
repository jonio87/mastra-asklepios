import { describe, expect, it } from '@jest/globals';
import { normalizeSpecialty } from './specialty-normalizer.js';

describe('normalizeSpecialty', () => {
  it('normalizes case: Neurology → neurology', () => {
    expect(normalizeSpecialty('Neurology')).toBe('neurology');
  });

  it('normalizes case: neurology → neurology', () => {
    expect(normalizeSpecialty('neurology')).toBe('neurology');
  });

  it('resolves synonym: Cardiovascular Medicine → cardiology', () => {
    expect(normalizeSpecialty('Cardiovascular Medicine')).toBe('cardiology');
  });

  it('handles compound name: Psychiatry and Psychology → psychiatry', () => {
    expect(normalizeSpecialty('Psychiatry and Psychology')).toBe('psychiatry');
  });

  it('handles institution-specific: Laboratory Medicine and Pathology → pathology', () => {
    expect(normalizeSpecialty('Laboratory Medicine and Pathology, Mayo Building,')).toBe(
      'pathology',
    );
  });

  it('normalizes Orofacial Pain → pain_medicine', () => {
    expect(normalizeSpecialty('Orofacial Pain')).toBe('pain_medicine');
  });

  it('normalizes Trigeminal Pain → pain_medicine', () => {
    expect(normalizeSpecialty('Trigeminal Pain')).toBe('pain_medicine');
  });

  it('normalizes Physical Medicine and Rehabilitation → physical_medicine', () => {
    expect(normalizeSpecialty('Physical Medicine and Rehabilitation')).toBe('physical_medicine');
  });

  it('normalizes EMG/nerve conduction → neurophysiology', () => {
    expect(normalizeSpecialty('EMG/nerve conduction')).toBe('neurophysiology');
  });

  it('passes through known canonical values', () => {
    expect(normalizeSpecialty('sleep_medicine')).toBe('sleep_medicine');
    expect(normalizeSpecialty('orthopedics')).toBe('orthopedics');
  });

  it('maps empty string to other', () => {
    expect(normalizeSpecialty('')).toBe('other');
  });

  it('maps Unknown to other', () => {
    expect(normalizeSpecialty('Unknown')).toBe('other');
  });

  it('maps truly unknown values to other', () => {
    expect(normalizeSpecialty('something_random_xyz')).toBe('other');
  });

  it('is case-insensitive for Polish terms', () => {
    expect(normalizeSpecialty('NEUROLOGY')).toBe('neurology');
    expect(normalizeSpecialty('Otolaryngology')).toBe('otolaryngology');
  });

  it('handles Rheumatology case variant', () => {
    expect(normalizeSpecialty('Rheumatology')).toBe('rheumatology');
    expect(normalizeSpecialty('rheumatology')).toBe('rheumatology');
  });

  it('neurosurgery matches before neurology', () => {
    expect(normalizeSpecialty('neurosurgery')).toBe('neurosurgery');
    expect(normalizeSpecialty('Neurosurgery')).toBe('neurosurgery');
  });
});
