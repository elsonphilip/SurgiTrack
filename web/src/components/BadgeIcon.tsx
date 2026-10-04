import type { ReactNode } from "react";

/** Cute round badge icons (48x48), one per badge id in lib/game.ts. Locked badges reuse the same art, greyed out by CSS. */
const INK = "#26263a", CREAM = "#F1F7F6", STEEL = "#5AA4D6", MINT = "#3D8571", AMBER = "#E3A857", ROSE = "#F28BA8";

function Face({ x, y, s = 1, sleepy = false, ink = INK }: { x: number; y: number; s?: number; sleepy?: boolean; ink?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="-6.2" cy="2.6" rx="2.2" ry="1.4" fill={ROSE} opacity=".6" />
      <ellipse cx="6.2" cy="2.6" rx="2.2" ry="1.4" fill={ROSE} opacity=".6" />
      {sleepy ? (
        <path d="M-5.6 -1 q1.6 1.8 3.2 0 M2.4 -1 q1.6 1.8 3.2 0" stroke={ink} strokeWidth="1.3" fill="none" strokeLinecap="round" />
      ) : (
        <>
          <circle cx="-4" cy="-0.6" r="1.5" fill={ink} /><circle cx="4" cy="-0.6" r="1.5" fill={ink} />
          <circle cx="-3.5" cy="-1.1" r=".5" fill="#fff" /><circle cx="4.5" cy="-1.1" r=".5" fill="#fff" />
        </>
      )}
      <path d="M-2 2.4 q2 2 4 0" stroke={ink} strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </g>
  );
}

const star = (cx: number, cy: number, R: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r : R; return `${(cx + Math.cos(a) * k).toFixed(2)},${(cy + Math.sin(a) * k).toFixed(2)}`; }).join(" ");

const Sparkle = ({ x, y, s = 1, c = CREAM }: { x: number; y: number; s?: number; c?: string }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 -3 L.9 -.9 L3 0 L.9 .9 L0 3 L-.9 .9 L-3 0 L-.9 -.9Z" fill={c} />
);

const ART: Record<string, { bg: [string, string]; art: ReactNode }> = {
  // a bandage with a sleepy smile: your very first patch-up
  first: { bg: [MINT, STEEL], art: (
    <g>
      <g transform="rotate(-35 24 25)">
        <rect x="8" y="17" width="32" height="15" rx="7.5" fill="#F6D7B8" />
        <rect x="18" y="17" width="12" height="15" fill="#FBE8D2" />
        {[[12.5, 21], [12.5, 28], [35.5, 21], [35.5, 28]].map(([cx, cy]) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r=".9" fill="#E2B891" />)}
        <Face x={24} y={24} s={0.62} sleepy />
      </g>
      <Sparkle x={38} y={11} s={1.1} /><Sparkle x={10} y={37} s={0.8} />
    </g>) },
  // a bullseye with a dotted flight line through it
  line: { bg: [STEEL, "#2f6fa3"], art: (
    <g>
      <circle cx="24" cy="24" r="15" fill={CREAM} /><circle cx="24" cy="24" r="10.5" fill={STEEL} /><circle cx="24" cy="24" r="6.2" fill={CREAM} /><circle cx="24" cy="24" r="3.1" fill={ROSE} />
      <path d="M6 33 Q 18 36 24 24 T 43 15" stroke={INK} strokeWidth="1.6" strokeDasharray="1.2 3" strokeLinecap="round" fill="none" />
      <circle cx="24" cy="24" r="1.2" fill={INK} />
      <path d="M38 8 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1z" fill="#fff" />
    </g>) },
  // a calm little hand
  steady: { bg: ["#7a6bd6", "#3b3a8f"], art: (
    <g>
      {[[15, 11, -10], [20.5, 8, -3], [26, 8, 3], [31.5, 11, 10]].map(([x, y, r]) => <rect key={x} x={x - 2.6} y={y} width="5.2" height="17" rx="2.6" fill="#FBD9B5" transform={`rotate(${r} ${x} ${y + 14})`} />)}
      <rect x="13" y="20" width="22" height="19" rx="9" fill="#FBD9B5" />
      <rect x="9" y="25" width="7" height="12" rx="3.5" fill="#FBD9B5" transform="rotate(35 12 31)" />
      <Face x={24} y={30} s={0.95} />
      <path d="M6 14 q-2 4 0 8 M42 14 q2 4 0 8" stroke={CREAM} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".8" />
    </g>) },
  // a spool of thread
  silk: { bg: [ROSE, AMBER], art: (
    <g>
      <rect x="12" y="8" width="24" height="6" rx="3" fill="#E9D5B5" /><rect x="12" y="34" width="24" height="6" rx="3" fill="#E9D5B5" />
      <rect x="14.5" y="13" width="19" height="22" rx="3" fill={CREAM} />
      {[17, 21, 25, 29, 33].map((y) => <path key={y} d={`M14.5 ${y} h19`} stroke="#d7e6e6" strokeWidth="1" />)}
      <Face x={24} y={25} s={0.85} />
      <path d="M33.5 30 q8 2 6 8 q-2 5 -9 3" stroke={CREAM} strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </g>) },
  // a star medal
  ace: { bg: [AMBER, "#d9774a"], art: (
    <g>
      <path d="M17 28 l-4 14 6 -3 3 5 3 -13z M31 28 l4 14 -6 -3 -3 5 -3 -13z" fill={ROSE} />
      <polygon points={star(24, 22, 17, 8.4)} fill="#FFE08A" stroke="#fff3c4" strokeWidth="1.4" strokeLinejoin="round" />
      <Face x={24} y={22.5} s={0.95} />
      <Sparkle x={8} y={10} s={1.2} /><Sparkle x={41} y={36} s={0.9} />
    </g>) },
  // a top hat with three stars
  hat: { bg: ["#8b5fd6", "#4a2f93"], art: (
    <g>
      <ellipse cx="24" cy="35" rx="16" ry="4.6" fill="#2d2347" />
      <rect x="14" y="14" width="20" height="21" rx="3" fill="#3a2d5e" />
      <rect x="14" y="27" width="20" height="5" fill={ROSE} />
      <ellipse cx="24" cy="14" rx="10" ry="3" fill="#4c3d7a" />
      <Face x={24} y={22.5} s={0.85} ink={CREAM} />
      {[[13, 8], [24, 4.5], [35, 8]].map(([x, y]) => <polygon key={x} points={star(x, y, 3.8, 1.7)} fill="#FFE08A" />)}
    </g>) },
  // a happy face bouncing back with a loop arrow
  comeback: { bg: [MINT, "#2a6f8f"], art: (
    <g>
      <circle cx="24" cy="25" r="11.5" fill="#FFE08A" />
      <Face x={24} y={25} s={1.05} />
      <path d="M8.5 22 A16 16 0 0 1 34 11" stroke={CREAM} strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M36.5 6.5 L35 13.5 L28.5 10.5Z" fill={CREAM} />
      <path d="M39.5 28 A16 16 0 0 1 14 39" stroke={CREAM} strokeWidth="2.6" strokeLinecap="round" fill="none" opacity=".6" />
    </g>) },
  // a rocket blasting upward
  level: { bg: [STEEL, "#5b4bb5"], art: (
    <g>
      <path d="M19 33 q5 12 10 0z" fill={AMBER} /><path d="M21.5 33 q2.5 7 5 0z" fill="#fff3c4" />
      <path d="M17 24 l-6 9 7 -2z M31 24 l6 9 -7 -2z" fill={MINT} />
      <path d="M24 5 C33 12 32 26 30 33 H18 C16 26 15 12 24 5Z" fill={CREAM} />
      <path d="M24 5 C28 8 29.5 11 30 13 H18 C18.5 11 20 8 24 5Z" fill={ROSE} />
      <circle cx="24" cy="21" r="5" fill="#bfe1f7" stroke="#8fb9d6" strokeWidth="1" />
      <Face x={24} y={21.2} s={0.45} />
      <Sparkle x={9} y={12} s={1} /><Sparkle x={40} y={20} s={0.9} />
    </g>) },
  // a calendar with a streak flame
  regular: { bg: [AMBER, "#c9603f"], art: (
    <g>
      <rect x="9" y="12" width="30" height="27" rx="5" fill={CREAM} />
      <path d="M9 17 a5 5 0 0 1 5 -5 h20 a5 5 0 0 1 5 5 v4 H9z" fill={ROSE} />
      <rect x="15" y="8" width="3.6" height="8" rx="1.8" fill="#fff" /><rect x="29.4" y="8" width="3.6" height="8" rx="1.8" fill="#fff" />
      <Face x={24} y={31} s={0.85} />
      <text x="24" y="25.2" textAnchor="middle" fontFamily="Montserrat, sans-serif" fontWeight="800" fontSize="7.5" fill={INK}>10</text>
    </g>) },
};

export function BadgeIcon({ id, size = 46 }: { id: string; size?: number }) {
  const a = ART[id] ?? ART.first;
  const gid = `bg-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-hidden className="badge-svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a.bg[0]} /><stop offset="1" stopColor={a.bg[1]} /></linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill={`url(#${gid})`} />
      <circle cx="24" cy="24" r="22.6" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="1.2" />
      {a.art}
    </svg>
  );
}
