// Time-of-day greeting for the briefing button + the message sent to Zenith. Uses the browser's
// local clock (the owner's machine = IST), so the 8 PM button reads "Good evening", not "Good morning".

export function briefingGreeting(d = new Date()): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Hello"; // late night → neutral (Zenith still gives the briefing)
}
