/** Plain-language wording shared by the Simple view. */
export const gradeWord = (score: number) => (score >= 85 ? "Excellent" : score >= 75 ? "Good" : score >= 60 ? "Getting there" : "Keep practicing");
export const tremorWord = (t: number) => (t < 2 ? "Very steady" : t < 4 ? "Mild" : t < 6 ? "Noticeable" : "Strong");
export const smoothWord = (v: number) => (v >= 80 ? "Smooth" : v >= 60 ? "A little jerky" : "Jerky");

export function coachingTip(acc: number, trem: number, smooth: number) {
  const deficit = [100 - acc, trem * 10, 100 - smooth];
  const worst = deficit.indexOf(Math.max(...deficit));
  return [
    "Biggest opportunity: staying inside the band. Slow down on the turns and keep your eyes on the next stretch of the line.",
    "Biggest opportunity: tremor. Rest your forearm on the pad, relax your grip, and breathe out slowly as you trace.",
    "Biggest opportunity: smoothness. Aim for one continuous motion rather than lots of small corrections.",
  ][worst];
}
