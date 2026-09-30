/**
 * The dashboard greeting: "Good morning, Neema".
 */

export function timeOfDayGreeting(hour) {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

// Placeholder account names such as the setup default "System Administrator":
// greeting someone as "System" or "Admin" is not greeting the person.
const PLACEHOLDER = /^(?:the\s+)?(?:(?:system|super|salon|site)\s+)?(?:admin|administrator|user|account)$/i;

// A title on its own ("Dr.") is not a name, so it stays with the next word: "Dr. Amina".
const TITLE = /^(?:mr|mrs|ms|miss|mx|dr|prof|bi|bw)\.?$/i;

/** What to call the signed-in person, or null when their account has no real name yet. */
export function greetingName(fullName) {
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!name || PLACEHOLDER.test(name)) return null;
  const [first, second] = name.split(' ');
  return TITLE.test(first) && second ? `${first} ${second}` : first;
}
