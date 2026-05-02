interface DwellRingProps {
  progress: number;
  color: string;
  r?: number;
  vb?: number;
}

export default function DwellRing({ progress, color, r = 18, vb = 42 }: DwellRingProps) {
  const circ = 2 * Math.PI * r;
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "rotate(-90deg)", pointerEvents: "none" }}
      viewBox={`0 0 ${vb} ${vb}`}
    >
      <circle
        cx={vb / 2} cy={vb / 2} r={r}
        fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - progress)}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.06s linear" }}
      />
    </svg>
  );
}
