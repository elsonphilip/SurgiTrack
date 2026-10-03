export const SPLASH_COOKIE = "st_splash";

const QUOTES = [
  "Precision matters.",
  "Steady hands save lives.",
  "Every millimeter counts.",
  "Calm hands. Clear mind.",
  "Master the tremor. Own the cut.",
  "Small movements. Big consequences.",
];

/** One quote per page load (the first is the default favourite). */
export function pickQuote(): string {
  return Math.random() < 0.4 ? QUOTES[0] : QUOTES[Math.floor(Math.random() * QUOTES.length)];
}
