import { describe, expect, it } from 'vitest';
import { greetingName, timeOfDayGreeting } from './greeting';

describe('greetingName', () => {
  it('uses the first name of the signed-in person', () => {
    expect(greetingName('Neema Mwakyusa')).toBe('Neema');
    expect(greetingName('  Rehema   Said ')).toBe('Rehema');
    expect(greetingName('Zola')).toBe('Zola');
  });

  it('keeps a title with the name that follows it', () => {
    expect(greetingName('Dr. Amina Hassan')).toBe('Dr. Amina');
    expect(greetingName('Bi Mwanaisha Ali')).toBe('Bi Mwanaisha');
  });

  it('does not greet placeholder account names', () => {
    for (const name of ['System Administrator', 'Administrator', 'admin', 'Super Admin', 'System Admin', '', null, undefined]) {
      expect(greetingName(name)).toBeNull();
    }
  });

  it('greets real names that start like a placeholder', () => {
    expect(greetingName('Admin Juma')).toBe('Admin');
    expect(greetingName('Salon Owner')).toBe('Salon');
  });
});

describe('timeOfDayGreeting', () => {
  it('follows the salon clock', () => {
    expect(timeOfDayGreeting(6)).toBe('Good morning');
    expect(timeOfDayGreeting(11)).toBe('Good morning');
    expect(timeOfDayGreeting(12)).toBe('Good afternoon');
    expect(timeOfDayGreeting(16)).toBe('Good afternoon');
    expect(timeOfDayGreeting(17)).toBe('Good evening');
    expect(timeOfDayGreeting(23)).toBe('Good evening');
  });
});
