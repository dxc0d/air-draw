import { useEffect, useRef, useState, useCallback, CSSProperties } from "react";
import { Hands, Results, HAND_CONNECTIONS } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { Pen, Paintbrush, Highlighter, Zap, Sparkles, Pencil, Link } from "lucide-react";
import Glass from "../components/Glass";
import DwellRing from "../components/DwellRing";
import { rawGesture, cursorPoint, GestureMode, LM } from "../lib/gestures";
import { strokeWith, ToolId } from "../lib/drawing";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = [
  { name: "White",  hex: "#FFFFFF" }, { name: "Red",    hex: "#FF4455" },
  { name: "Orange", hex: "#FF8C00" }, { name: "Yellow", hex: "#FFE030" },
  { name: "Lime",   hex: "#3DFF88" }, { name: "Cyan",   hex: "#22E5FF" },
  { name: "Blue",   hex: "#4488FF" }, { name: "Purple", hex: "#CC44FF" },
  { name: "Pink",   hex: "#FF44C8" }, { name: "Black",  hex: "#111111" },
];

const TOOLS: { id: ToolId; label: string; Icon: React.FC<{ size?: number; color?: string }> }[] = [
  { id: "pen",    label: "Pen",    Icon: Pen },
  { id: "brush",  label: "Brush",  Icon: Paintbrush },
  { id: "marker", label: "Marker", Icon: Highlighter },
  { id: "spray",  label: "Spray",  Icon: Sparkles },
  { id: "neon",   label: "Neon",   Icon: Zap },
  { id: "chalk",  label: "Chalk",  Icon: Pencil },
];

const SIZES = [3, 6, 10, 16, 24];
const NUM_SPACES = 5;
const DWELL_MS = 750;

type BgMode = "camera" | "black" | "white" | "chalkboard" | "navy";
const BG_OPTIONS: { id: BgMode; emoji: string; label: string; bg: string; dark: boolean }[] = [
  { id: "camera",     emoji: "📷", label: "Camera",     bg: "#0a0a0a", dark: true  },
  { id: "black",      emoji: "⬛", label: "Black",      bg: "#0a0a0a", dark: true  },
  { id: "white",      emoji: "⬜", label: "Whiteboard", bg: "#f4f0eb", dark: false },
  { id: "chalkboard", emoji: "🟢", label: "Chalkboard", bg: "#2b4a39", dark: true  },
  { id: "navy",       emoji: "🌌", label: "Night",      bg: "#09091e", dark: true  },
];

const KB_ROWS = [
  ["1","2","3","4","5","6","7","8","9","0","-","."],
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l","⌫"],
  ["z","x","c","v","b","n","m","/","_","@"],
  ["github.com/","https://",".com",".io","SPACE","GO→"],
];
const KB_FLAT = KB_ROWS.flat();

// ─── Hover target types ───────────────────────────────────────────────────────

type HoverCat = "color" | "tool" | "size" | "bg" | "space" | "github" | "clear" | "key";
interface HoverTarget { category: HoverCat; index?: number; key?: string }

function targetsEqual(a: HoverTarget, b: HoverTarget) {
  return a.category === b.category && a.index === b.index && a.key === b.key;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AirDraw() {
  // Canvas refs
  const videoRef      = useRef<HTMLVideoElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const handCanvasRef = useRef<HTMLCanvasElement>(null);
  const prevPt        = useRef<{ x: number; y: number } | null>(null);

  // Gesture pipeline refs
  const gBuf         = useRef<GestureMode[]>([]);
  const gStable      = useRef<GestureMode>("standby");
  const posBuf       = useRef<{ x: number; y: number }[]>([]);
  const dwellRef     = useRef<{ target: HoverTarget; start: number } | null>(null);
  const pinchFired   = useRef(false); // prevent multi-frame pinch repeat

  // All hoverable button refs
  const colorRefs  = useRef<(HTMLButtonElement | null)[]>([]);
  const toolRefs   = useRef<(HTMLButtonElement | null)[]>([]);
  const sizeRefs   = useRef<(HTMLButtonElement | null)[]>([]);
  const bgRefs     = useRef<(HTMLButtonElement | null)[]>([]);
  const spaceRefs  = useRef<(HTMLButtonElement | null)[]>([]);
  const githubRef  = useRef<HTMLButtonElement | null>(null);
  const clearRef   = useRef<HTMLButtonElement | null>(null);
  const keyRefs    = useRef<(HTMLButtonElement | null)[]>([]);

  // Multi-space storage
  const spaces = useRef<(ImageData | null)[]>(Array(NUM_SPACES).fill(null));

  // Drawing state (refs for fast access inside onResults)
  const colorR = useRef("#FFFFFF");
  const toolR  = useRef<ToolId>("pen");
  const sizeR  = useRef(8);
  const spaceR = useRef(0);
  const kbOpenR = useRef(false);

  // React state (for UI re-renders)
  const [color, setColor]           = useState("#FFFFFF");
  const [tool, setTool]             = useState<ToolId>("pen");
  const [size, setSize]             = useState(8);
  const [bgMode, setBgMode]         = useState<BgMode>("camera");
  const [activeSpace, setActiveSpace] = useState(0);
  const [showKb, setShowKb]         = useState(false);
  const [urlInput, setUrlInput]     = useState("https://github.com/");
  const [gesture, setGesture]       = useState<GestureMode>("standby");
  const [fingerPct, setFingerPct]   = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered]       = useState<HoverTarget | null>(null);
  const [dwellProg, setDwellProg]   = useState(0);
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [spacesFilled, setSpacesFilled] = useState<boolean[]>(Array(NUM_SPACES).fill(false));
  const [uiScale, setUiScale]       = useState(1);

  // Sync refs to state
  useEffect(() => { colorR.current = color; }, [color]);
  useEffect(() => { toolR.current  = tool; },  [tool]);
  useEffect(() => { sizeR.current  = size; },  [size]);
  useEffect(() => { spaceR.current = activeSpace; }, [activeSpace]);
  useEffect(() => { kbOpenR.current = showKb; }, [showKb]);

  // Responsive scale: fits iPad (768), laptop (1280), 4K (3840)
  useEffect(() => {
    const update = () => setUiScale(Math.min(Math.max(window.innerWidth / 1440, 0.58), 1.3));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const s = (n: number) => Math.round(n * uiScale); // responsive size helper

  // ── Canvas operations ─────────────────────────────────────────────────────

  const clearCanvas = useCallback(() => {
    const c = drawCanvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    spaces.current[spaceR.current] = null;
    setSpacesFilled(p => { const n = [...p]; n[spaceR.current] = false; return n; });
  }, []);

  const switchSpace = useCallback((idx: number) => {
    const c = drawCanvasRef.current;
    if (!c || idx === spaceR.current) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    spaces.current[spaceR.current] = ctx.getImageData(0, 0, c.width, c.height);
    ctx.clearRect(0, 0, c.width, c.height);
    const saved = spaces.current[idx];
    if (saved) ctx.putImageData(saved, 0, 0);
    spaceR.current = idx;
    setActiveSpace(idx);
  }, []);

  const handleKey = useCallback((key: string) => {
    if (key === "⌫")    { setUrlInput(u => u.slice(0, -1)); return; }
    if (key === "SPACE") { setUrlInput(u => u + " "); return; }
    if (key === "GO→") {
      setUrlInput(u => {
        const url = u.startsWith("http") ? u : "https://" + u;
        window.open(url, "_blank");
        return u;
      });
      return;
    }
    setUrlInput(u => u + key);
  }, []);

  const commitTarget = useCallback((t: HoverTarget) => {
    switch (t.category) {
      case "color":  if (t.index !== undefined) { setColor(COLORS[t.index].hex); colorR.current = COLORS[t.index].hex; } break;
      case "tool":   if (t.index !== undefined) { setTool(TOOLS[t.index].id);   toolR.current  = TOOLS[t.index].id; }  break;
      case "size":   if (t.index !== undefined) { setSize(SIZES[t.index]);       sizeR.current  = SIZES[t.index]; }    break;
      case "bg":     if (t.index !== undefined) setBgMode(BG_OPTIONS[t.index].id); break;
      case "space":  if (t.index !== undefined) switchSpace(t.index); break;
      case "github": setShowKb(v => !v); break;
      case "clear":  clearCanvas(); break;
      case "key":    if (t.key) handleKey(t.key); break;
    }
  }, [switchSpace, clearCanvas, handleKey]);

  // ── Hit-testing helpers ───────────────────────────────────────────────────

  const hitRefs = useCallback((
    refs: (HTMLButtonElement | null)[],
    cat: HoverCat, sx: number, sy: number, pad = 16,
  ): HoverTarget | null => {
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i]?.getBoundingClientRect();
      if (r && sx >= r.left - pad && sx <= r.right + pad && sy >= r.top - pad && sy <= r.bottom + pad)
        return { category: cat, index: i };
    }
    return null;
  }, []);

  const hitOne = useCallback((
    ref: HTMLButtonElement | null, cat: HoverCat, sx: number, sy: number, pad = 16,
  ): HoverTarget | null => {
    if (!ref) return null;
    const r = ref.getBoundingClientRect();
    return (sx >= r.left - pad && sx <= r.right + pad && sy >= r.top - pad && sy <= r.bottom + pad)
      ? { category: cat } : null;
  }, []);

  const hitKeys = useCallback((sx: number, sy: number): HoverTarget | null => {
    const pad = 6;
    for (let i = 0; i < keyRefs.current.length; i++) {
      const r = keyRefs.current[i]?.getBoundingClientRect();
      if (r && sx >= r.left - pad && sx <= r.right + pad && sy >= r.top - pad && sy <= r.bottom + pad)
        return { category: "key", key: KB_FLAT[i] };
    }
    return null;
  }, []);

  // ── MediaPipe results ─────────────────────────────────────────────────────

  const onResults = useCallback((results: Results) => {
    const handC = handCanvasRef.current;
    const drawC = drawCanvasRef.current;
    if (!handC || !drawC) return;
    const hCtx = handC.getContext("2d");
    if (!hCtx) return;
    hCtx.clearRect(0, 0, handC.width, handC.height);

    if (!results.multiHandLandmarks?.length) {
      prevPt.current = null; dwellRef.current = null;
      gBuf.current = []; posBuf.current = [];
      gStable.current = "standby"; pinchFired.current = false;
      setGesture("standby"); setFingerPct(null);
      setHovered(null); setDwellProg(0);
      return;
    }

    const lm = results.multiHandLandmarks[0] as LM[];

    // Draw skeleton
    drawConnectors(hCtx, lm, HAND_CONNECTIONS, { color: "rgba(255,255,255,0.20)", lineWidth: 1.5 });
    drawLandmarks(hCtx, lm, { color: "rgba(255,255,255,0.55)", lineWidth: 1, radius: 3 });

    // Stabilise gesture: require GSTAB consecutive matching frames
    const GSTAB = 3;
    const raw = rawGesture(lm);
    gBuf.current = [...gBuf.current.slice(-(GSTAB - 1)), raw];
    const stable = gBuf.current.length >= GSTAB && gBuf.current.every(x => x === raw);
    const g: GestureMode = stable ? raw : gStable.current;
    if (stable) gStable.current = g;
    setGesture(g);

    // Smooth position (4-frame rolling average)
    const SMOOTH = 4;
    const raw2d = cursorPoint(lm, g);
    posBuf.current = [...posBuf.current.slice(-(SMOOTH - 1)), raw2d];
    const avg = posBuf.current.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y }), { x: 0, y: 0 });
    const cx = avg.x / posBuf.current.length;
    const cy = avg.y / posBuf.current.length;
    setFingerPct({ x: cx * 100, y: cy * 100 });

    const sx = (1 - cx) * window.innerWidth;
    const sy = cy * window.innerHeight;

    // ── Pinch: instant commit (fires once per pinch gesture) ─────────────
    if (g === "pinch") {
      if (!pinchFired.current) {
        const target =
          hitRefs(colorRefs.current, "color", sx, sy) ??
          hitRefs(toolRefs.current,  "tool",  sx, sy) ??
          hitRefs(sizeRefs.current,  "size",  sx, sy) ??
          hitRefs(bgRefs.current,    "bg",    sx, sy) ??
          hitRefs(spaceRefs.current, "space", sx, sy) ??
          hitOne(githubRef.current,  "github", sx, sy) ??
          hitOne(clearRef.current,   "clear",  sx, sy) ??
          (kbOpenR.current ? hitKeys(sx, sy) : null);
        if (target) { commitTarget(target); pinchFired.current = true; }
      }
      dwellRef.current = null; setHovered(null); setDwellProg(0);
      return;
    }
    pinchFired.current = false;

    // ── Select mode: hover + dwell ────────────────────────────────────────
    if (g === "select") {
      prevPt.current = null;
      const found =
        hitRefs(colorRefs.current, "color", sx, sy) ??
        hitRefs(toolRefs.current,  "tool",  sx, sy) ??
        hitRefs(sizeRefs.current,  "size",  sx, sy) ??
        hitRefs(bgRefs.current,    "bg",    sx, sy) ??
        hitRefs(spaceRefs.current, "space", sx, sy) ??
        hitOne(githubRef.current,  "github", sx, sy) ??
        hitOne(clearRef.current,   "clear",  sx, sy) ??
        (kbOpenR.current ? hitKeys(sx, sy) : null);

      if (found) {
        setHovered(found);
        const now = Date.now();
        const dw = dwellRef.current;
        if (dw && targetsEqual(dw.target, found)) {
          const elapsed = now - dw.start;
          const prog = Math.min(elapsed / DWELL_MS, 1);
          setDwellProg(prog);
          if (elapsed >= DWELL_MS) {
            commitTarget(found);
            dwellRef.current = null; setDwellProg(0); setHovered(null);
          }
        } else {
          dwellRef.current = { target: found, start: now }; setDwellProg(0);
        }
      } else {
        setHovered(null); dwellRef.current = null; setDwellProg(0);
      }
      return;
    }

    setHovered(null); dwellRef.current = null; setDwellProg(0);

    // ── Draw / Erase ──────────────────────────────────────────────────────
    if (g === "draw" || g === "erase") {
      const dCtx = drawC.getContext("2d");
      if (!dCtx) return;
      const px = cx * drawC.width; const py = cy * drawC.height;
      if (g === "erase") {
        dCtx.save();
        dCtx.globalCompositeOperation = "destination-out";
        dCtx.beginPath(); dCtx.arc(px, py, sizeR.current * 3.5, 0, Math.PI * 2);
        dCtx.fillStyle = "rgba(0,0,0,1)"; dCtx.fill(); dCtx.restore();
      } else {
        strokeWith(dCtx, toolR.current, prevPt.current, { x: px, y: py }, colorR.current, sizeR.current);
        setSpacesFilled(p => { if (p[spaceR.current]) return p; const n=[...p]; n[spaceR.current]=true; return n; });
      }
      prevPt.current = { x: px, y: py };
    } else {
      prevPt.current = null;
    }
  }, [hitRefs, hitOne, hitKeys, commitTarget]);

  // ── MediaPipe setup ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!videoRef.current) return;
    let cancelled = false;
    const hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.82, minTrackingConfidence: 0.78 });
    hands.onResults(onResults);
    const cam = new Camera(videoRef.current, {
      onFrame: async () => { if (!cancelled && videoRef.current) await hands.send({ image: videoRef.current }); },
      width: 1280, height: 720,
    });
    cam.start()
      .then(() => { if (!cancelled) setIsLoading(false); })
      .catch(() => { if (!cancelled) { setError("Camera access denied. Allow permissions and reload."); setIsLoading(false); } });
    return () => { cancelled = true; cam.stop(); hands.close(); };
  }, [onResults]);

  // ── Derived UI values ─────────────────────────────────────────────────────

  const bgOpt  = BG_OPTIONS.find(b => b.id === bgMode)!;
  const isDark = bgOpt.dark;
  const txt    = isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.75)";
  const dim    = isDark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.28)";
  const sep    = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  const modeColors: Record<GestureMode, string> = {
    standby: "#444", draw: color, select: "#CC88FF", erase: "#aaa", pinch: "#66aaff",
  };
  const modeLabels: Record<GestureMode, string> = {
    standby: "READY", draw: "DRAWING", select: "SELECTING", erase: "ERASING", pinch: "PINCH",
  };
  const modeGlows: Record<GestureMode, string | undefined> = {
    standby: undefined, draw: color + "55", select: "rgba(180,80,255,0.4)",
    erase: undefined, pinch: "rgba(80,150,255,0.35)",
  };

  const cursorSz = gesture === "erase" ? s(size * 7) : gesture === "draw" ? Math.max(s(size * 1.5), 10) : s(20);

  const isHov = (cat: HoverCat, idx?: number, key?: string) => {
    if (!hovered || hovered.category !== cat) return false;
    if (idx !== undefined && hovered.index !== idx) return false;
    if (key !== undefined && hovered.key !== key) return false;
    return true;
  };

  // Shared button style helper
  const uiBtn = (active: boolean, hov: boolean, accentColor?: string): CSSProperties => ({
    background: active
      ? `linear-gradient(135deg,${accentColor ?? color}44,${accentColor ?? color}1a)`
      : hov ? (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)") : "transparent",
    outline: `1px solid ${active ? (accentColor ?? color) + "99" : hov ? (isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)") : (isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.09)")}`,
    boxShadow: active ? `0 0 14px ${(accentColor ?? color)}55, inset 0 1px 0 rgba(255,255,255,0.15)` : "none",
    transform: active ? "scale(1.07)" : hov ? "scale(1.04)" : "scale(1)",
  });

  const labelStyle: CSSProperties = {
    fontSize: s(8), fontWeight: 700, letterSpacing: "0.22em",
    color: dim, textTransform: "uppercase", textAlign: "center",
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", userSelect: "none", background: bgOpt.bg }}>
      <style>{`
        @keyframes spin1 { to{transform:rotate(360deg)} }
        @keyframes spin2 { to{transform:rotate(-360deg)} }
        @keyframes pulse { 0%,100%{transform:scale(1)}50%{transform:scale(1.4)} }
        .pulse { animation: pulse 1.5s ease-in-out infinite; }
      `}</style>

      {/* Camera */}
      <video ref={videoRef} playsInline muted style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
        transform: "scaleX(-1)", pointerEvents: "none",
        opacity: bgMode === "camera" ? (gesture === "draw" ? 0.42 : 0.52) : 0,
        transition: "opacity 0.4s",
      }} />

      {/* Drawing layer */}
      <canvas ref={drawCanvasRef} width={1280} height={720}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "scaleX(-1)" }} />

      {/* Skeleton overlay */}
      <canvas ref={handCanvasRef} width={1280} height={720}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "scaleX(-1)" }} />

      {/* Cursor */}
      {fingerPct && (
        <div style={{
          position: "absolute", zIndex: 30, pointerEvents: "none", borderRadius: "50%",
          left: `${100 - fingerPct.x}%`, top: `${fingerPct.y}%`,
          width: cursorSz, height: cursorSz, transform: "translate(-50%,-50%)",
          transition: "width 0.07s, height 0.07s",
          backgroundColor: gesture === "draw" ? color + "44" : gesture === "pinch" ? "rgba(100,150,255,0.18)" : "rgba(150,150,150,0.1)",
          border: `2px solid ${gesture === "draw" ? color : gesture === "pinch" ? "rgba(100,150,255,0.8)" : "rgba(160,160,160,0.55)"}`,
          boxShadow: gesture === "draw" ? `0 0 16px ${color}aa` : gesture === "pinch" ? "0 0 12px rgba(100,150,255,0.6)" : "none",
        }} />
      )}

      {/* ── TOP-CENTER SECOND ROW: Space / page tabs (horizontal) ──────── */}
      <Glass className="absolute z-40 rounded-full" dark={isDark}
        style={{ top: s(62), left: "50%", transform: "translateX(-50%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: s(5), padding: `${s(6)}px ${s(10)}px` }}>
          <span style={{ ...labelStyle, marginRight: s(2) }}>Page</span>
          {Array.from({ length: NUM_SPACES }, (_, i) => {
            const active = activeSpace === i;
            const hov = isHov("space", i);
            const filled = spacesFilled[i];
            return (
              <button key={i} ref={el => { spaceRefs.current[i] = el; }}
                onClick={() => switchSpace(i)}
                style={{
                  position: "relative", width: s(34), height: s(28),
                  borderRadius: s(8), border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexDirection: "column", gap: s(1),
                  transition: "transform 0.15s, background 0.15s",
                  ...uiBtn(active, hov, color),
                }}>
                {hov && dwellProg > 0 && <DwellRing progress={dwellProg} color={active ? color : (isDark ? "#fff" : "#333")} r={s(12)} vb={s(34)} />}
                <span style={{ fontSize: s(12), fontWeight: active ? 700 : 500, color: active ? color : txt, lineHeight: 1 }}>{i + 1}</span>
                {filled && !active && (
                  <div style={{ width: s(3), height: s(3), borderRadius: "50%", backgroundColor: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.35)" }} />
                )}
              </button>
            );
          })}
        </div>
      </Glass>

      {/* ── TOP-CENTER: Mode badge ───────────────────────────────────────── */}
      <Glass className="absolute top-4 left-1/2 -translate-x-1/2 z-40 rounded-full" dark={isDark} glow={modeGlows[gesture]}>
        <div style={{ display: "flex", alignItems: "center", gap: s(10), padding: `${s(10)}px ${s(22)}px` }}>
          <div className={gesture !== "standby" ? "pulse" : ""} style={{
            width: s(8), height: s(8), borderRadius: "50%",
            backgroundColor: modeColors[gesture], boxShadow: `0 0 8px ${modeColors[gesture]}`,
            transition: "background-color 0.25s", flexShrink: 0,
          }} />
          <span style={{ fontSize: s(11), fontWeight: 700, letterSpacing: "0.18em", color: txt }}>
            {modeLabels[gesture]}
          </span>
          {gesture === "draw" && (
            <div style={{ width: s(12), height: s(12), borderRadius: "50%", backgroundColor: color, flexShrink: 0,
              border: "1px solid rgba(255,255,255,0.3)", boxShadow: `0 0 8px ${color}88` }} />
          )}
        </div>
      </Glass>

      {/* ── TOP-RIGHT: URL / GitHub ──────────────────────────────────────── */}
      <Glass className="absolute top-4 right-3 z-40 rounded-2xl" dark={isDark}
        glow={showKb ? "rgba(100,60,255,0.4)" : undefined}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s(6), padding: s(10) }}>
          <span style={labelStyle}>Link</span>
          <button ref={el => { githubRef.current = el; }} onClick={() => setShowKb(v => !v)}
            style={{
              position: "relative", width: s(44), height: s(44), borderRadius: s(12), border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "transform 0.15s, background 0.15s",
              ...uiBtn(showKb, isHov("github"), "rgba(100,60,255,1)"),
              boxShadow: showKb ? "0 0 22px rgba(100,60,255,0.55)" : "none",
            }}>
            {isHov("github") && dwellProg > 0 && <DwellRing progress={dwellProg} color={showKb ? "#fff" : "rgba(100,60,255,0.8)"} r={s(19)} vb={s(44)} />}
            <Link size={s(18)} color={showKb ? "#c0a0ff" : (isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)")} />
          </button>
        </div>
      </Glass>

      {/* ── LEFT: Colors ─────────────────────────────────────────────────── */}
      <Glass className="absolute left-3 top-1/2 -translate-y-1/2 z-40 rounded-2xl" dark={isDark}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s(6), padding: s(10) }}>
          <span style={labelStyle}>Color</span>
          {COLORS.map((c, i) => {
            const active = color === c.hex; const hov = isHov("color", i);
            return (
              <button key={c.hex} ref={el => { colorRefs.current[i] = el; }}
                data-testid={`color-${c.name.toLowerCase()}`}
                onClick={() => setColor(c.hex)} title={c.name}
                style={{
                  position: "relative", width: s(34), height: s(34), borderRadius: "50%",
                  border: "none", background: "transparent", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transform: active ? "scale(1.25)" : hov ? "scale(1.12)" : "scale(1)",
                  transition: "transform 0.15s", flexShrink: 0,
                }}>
                {hov && dwellProg > 0 && <DwellRing progress={dwellProg} color={c.hex} r={s(15)} vb={s(34)} />}
                <div style={{
                  width: active ? s(25) : s(21), height: active ? s(25) : s(21), borderRadius: "50%",
                  backgroundColor: c.hex, transition: "width 0.15s, height 0.15s, box-shadow 0.15s",
                  boxShadow: active
                    ? `0 0 0 ${s(2.5)}px ${isDark ? "white" : "#333"},0 0 18px ${c.hex}cc`
                    : hov
                    ? `0 0 0 2px rgba(${isDark ? "255,255,255" : "0,0,0"},0.7),0 0 10px ${c.hex}88`
                    : `0 0 0 1px rgba(${isDark ? "255,255,255" : "0,0,0"},0.14)`,
                }} />
              </button>
            );
          })}
          <div style={{ width: "100%", height: 1, background: sep, margin: `${s(2)}px 0` }} />
          <button ref={el => { clearRef.current = el; }} onClick={clearCanvas} title="Clear"
            style={{
              position: "relative", width: s(30), height: s(30), borderRadius: "50%",
              border: "1px solid rgba(255,80,80,0.3)", background: "rgba(255,50,50,0.12)",
              color: "rgba(255,110,110,0.9)", cursor: "pointer", fontSize: s(12),
              display: "flex", alignItems: "center", justifyContent: "center",
              transform: isHov("clear") ? "scale(1.12)" : "scale(1)", transition: "transform 0.15s",
            }}>
            {isHov("clear") && dwellProg > 0 && <DwellRing progress={dwellProg} color="rgba(255,80,80,0.8)" r={s(13)} vb={s(30)} />}
            ✕
          </button>
        </div>
      </Glass>

      {/* ── RIGHT: Tools ─────────────────────────────────────────────────── */}
      <Glass className="absolute right-3 top-1/2 -translate-y-1/2 z-40 rounded-2xl" dark={isDark}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s(7), padding: s(10) }}>
          <span style={labelStyle}>Tool</span>
          {TOOLS.map(({ id, label, Icon }, i) => {
            const active = tool === id; const hov = isHov("tool", i);
            return (
              <button key={id} ref={el => { toolRefs.current[i] = el; }}
                data-testid={`tool-${id}`} onClick={() => setTool(id)} title={label}
                style={{
                  position: "relative", width: s(44), height: s(44), borderRadius: s(12),
                  border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "transform 0.15s, background 0.15s", flexShrink: 0,
                  ...uiBtn(active, hov),
                }}>
                {hov && dwellProg > 0 && <DwellRing progress={dwellProg} color={active ? color : (isDark ? "#fff" : "#000")} r={s(19)} vb={s(44)} />}
                <Icon size={s(18)} color={active ? color : (isDark ? (hov ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)") : (hov ? "rgba(0,0,0,0.8)" : "rgba(0,0,0,0.4)"))} />
              </button>
            );
          })}
        </div>
      </Glass>

      {/* ── BOTTOM-CENTER: Sizes + BG ────────────────────────────────────── */}
      <Glass className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-2xl" dark={isDark}>
        <div style={{ display: "flex", alignItems: "center", gap: s(6), padding: `${s(10)}px ${s(12)}px` }}>
          {/* Sizes */}
          <span style={{ ...labelStyle, marginRight: s(2) }}>Size</span>
          {SIZES.map((sz_, i) => {
            const active = size === sz_; const hov = isHov("size", i);
            return (
              <button key={sz_} ref={el => { sizeRefs.current[i] = el; }}
                data-testid={`size-${sz_}`} onClick={() => setSize(sz_)} title={`Size ${sz_}`}
                style={{
                  position: "relative", width: s(44), height: s(44), borderRadius: "50%",
                  border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: active ? `rgba(${hexRgb(color)},0.15)` : hov ? (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)") : "transparent",
                  outline: `1px solid ${active ? color + "88" : hov ? (isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.2)") : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)")}`,
                  boxShadow: active ? `0 0 12px ${color}44` : "none",
                  transform: active ? "scale(1.1)" : hov ? "scale(1.04)" : "scale(1)",
                  transition: "transform 0.15s", flexShrink: 0,
                }}>
                {hov && dwellProg > 0 && <DwellRing progress={dwellProg} color={active ? color : (isDark ? "#fff" : "#333")} r={s(19)} vb={s(44)} />}
                <div style={{
                  width: Math.min(s(sz_ + 4), s(24)), height: Math.min(s(sz_ + 4), s(24)), borderRadius: "50%",
                  backgroundColor: active ? color : (isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)"),
                  boxShadow: active ? `0 0 8px ${color}99` : "none",
                }} />
              </button>
            );
          })}
          {/* Divider */}
          <div style={{ width: 1, height: s(32), background: sep, margin: `0 ${s(4)}px`, flexShrink: 0 }} />
          {/* BG */}
          <span style={{ ...labelStyle, marginRight: s(2) }}>BG</span>
          {BG_OPTIONS.map((opt, i) => {
            const active = bgMode === opt.id; const hov = isHov("bg", i);
            return (
              <button key={opt.id} ref={el => { bgRefs.current[i] = el; }}
                title={opt.label} onClick={() => setBgMode(opt.id)}
                style={{
                  position: "relative", width: s(38), height: s(38), borderRadius: s(10),
                  border: "none", cursor: "pointer", fontSize: s(18),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: active ? (isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)") : hov ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)") : "transparent",
                  outline: `1px solid ${active ? (isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.28)") : (isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.09)")}`,
                  transform: active ? "scale(1.1)" : hov ? "scale(1.05)" : "scale(1)",
                  transition: "transform 0.15s", flexShrink: 0,
                }}>
                {hov && dwellProg > 0 && <DwellRing progress={dwellProg} color={isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.5)"} r={s(16)} vb={s(38)} />}
                {opt.emoji}
              </button>
            );
          })}
        </div>
      </Glass>

      {/* ── BOTTOM-RIGHT: Gesture guide ───────────────────────────────────── */}
      <Glass className="absolute bottom-4 right-3 z-40 rounded-2xl" dark={isDark}>
        <div style={{ display: "flex", flexDirection: "column", gap: s(7), padding: `${s(10)}px ${s(14)}px` }}>
          {([
            ["☝️", "1 finger → Draw"],
            ["✌️", "2 fingers → Hover+select"],
            ["🤏", "Pinch → Instant pick"],
            ["🖐️", "Open hand → Erase"],
            ["✊", "Fist → Standby"],
          ] as [string, string][]).map(([icon, text]) => (
            <div key={text} style={{ display: "flex", alignItems: "center", gap: s(8) }}>
              <span style={{ fontSize: s(14), lineHeight: 1, flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: s(10), color: dim, whiteSpace: "nowrap" }}>{text}</span>
            </div>
          ))}
        </div>
      </Glass>

      {/* ── CENTER OVERLAY: URL / virtual keyboard ────────────────────────── */}
      {showKb && (
        <div style={{
          position: "absolute", zIndex: 45, top: "50%", left: "50%",
          transform: "translate(-50%,-50%)", width: `min(${s(640)}px, 92vw)`,
        }}>
          <Glass className="w-full rounded-2xl" dark={isDark}>
            <div style={{ padding: s(16) }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: s(10) }}>
                <span style={{ fontSize: s(11), fontWeight: 700, color: dim, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  Open URL / GitHub Repo
                </span>
                <button onClick={() => setShowKb(false)}
                  style={{ width: s(26), height: s(26), borderRadius: "50%", border: "none", cursor: "pointer",
                    background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
                    color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)",
                    fontSize: s(13), display: "flex", alignItems: "center", justifyContent: "center" }}>
                  ✕
                </button>
              </div>

              {/* URL display */}
              <div style={{
                padding: `${s(8)}px ${s(12)}px`, marginBottom: s(12),
                background: isDark ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.7)",
                borderRadius: s(8), border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
                fontFamily: "monospace", fontSize: s(13), color: txt,
                minHeight: s(36), wordBreak: "break-all", display: "flex", alignItems: "center",
              }}>
                <span style={{ flex: 1 }}>
                  {urlInput || <span style={{ opacity: 0.3 }}>https://github.com/username/repo</span>}
                </span>
                <span style={{ display: "inline-block", width: 2, height: s(16), background: txt, marginLeft: 4, animation: "pulse 1s ease-in-out infinite" }} />
              </div>

              {/* Keyboard rows */}
              {KB_ROWS.map((row, ri) => (
                <div key={ri} style={{ display: "flex", gap: s(4), justifyContent: "center", marginBottom: s(4), flexWrap: "nowrap" }}>
                  {row.map(key => {
                    const fi = KB_FLAT.indexOf(key);
                    const hov = isHov("key", undefined, key);
                    const wide = key.length > 2;
                    const isGo = key === "GO→";
                    return (
                      <button key={key}
                        ref={el => { if (fi >= 0) keyRefs.current[fi] = el; }}
                        onClick={() => handleKey(key)}
                        style={{
                          position: "relative",
                          minWidth: wide ? s(74) : s(38), height: s(38),
                          borderRadius: s(7), border: "none", cursor: "pointer",
                          background: isGo
                            ? "rgba(90,40,230,0.75)"
                            : hov ? (isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)") : (isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"),
                          outline: `1px solid ${isDark ? "rgba(255,255,255,0.11)" : "rgba(0,0,0,0.1)"}`,
                          color: isGo ? "#fff" : (isDark ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.72)"),
                          fontSize: wide ? s(10) : s(14),
                          fontFamily: wide ? "sans-serif" : "monospace",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0, padding: `0 ${wide ? s(6) : 0}px`,
                          transform: hov ? "scale(1.1)" : "scale(1)",
                          transition: "transform 0.1s, background 0.1s",
                          boxShadow: isGo ? "0 2px 14px rgba(90,40,230,0.5)" : "none",
                        }}>
                        {/* Progress bar at key bottom for dwell */}
                        {hov && dwellProg > 0 && (
                          <div style={{
                            position: "absolute", bottom: 0, left: 0, height: s(2), borderRadius: s(1),
                            width: `${dwellProg * 100}%`, transition: "width 0.06s linear",
                            background: isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.6)",
                          }} />
                        )}
                        {key}
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* Quick-type shortcuts */}
              <div style={{ display: "flex", gap: s(6), marginTop: s(10), justifyContent: "center", flexWrap: "wrap" }}>
                {["https://", "github.com/", "http://", "CLEAR"].map(k => (
                  <button key={k} onClick={() => k === "CLEAR" ? setUrlInput("") : handleKey(k)}
                    style={{
                      padding: `${s(5)}px ${s(10)}px`, borderRadius: s(20), border: "none", cursor: "pointer",
                      background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                      outline: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
                      color: isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.6)",
                      fontSize: s(11), fontFamily: "monospace",
                    }}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </Glass>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.92)" }}>
          <Glass className="absolute" dark style={{ borderRadius: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "40px 52px" }}>
              <div style={{ position: "relative", width: 56, height: 56 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(160,80,255,0.2)" }} />
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#a855f7", animation: "spin1 1s linear infinite" }} />
                <div style={{ position: "absolute", inset: 10, borderRadius: "50%", border: "1.5px solid transparent", borderTopColor: "rgba(200,140,255,0.5)", animation: "spin2 0.65s linear infinite" }} />
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ color: "rgba(255,255,255,0.82)", fontSize: 14, fontWeight: 600 }}>Starting hand tracking…</p>
                <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 4 }}>Allow camera access when prompted</p>
              </div>
            </div>
          </Glass>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.88)" }}>
          <Glass className="absolute" dark style={{ borderRadius: 20, maxWidth: 380 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "36px 44px", textAlign: "center" }}>
              <div style={{ fontSize: 36, color: "#f87171" }}>⚠</div>
              <p style={{ color: "white", fontWeight: 600, fontSize: 16 }}>Camera Error</p>
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, lineHeight: 1.6 }}>{error}</p>
              <button onClick={() => window.location.reload()}
                style={{ marginTop: 8, padding: "10px 28px", borderRadius: 12, border: "none", cursor: "pointer",
                  background: "linear-gradient(135deg,#8844ff,#5522cc)", color: "white", fontWeight: 700,
                  boxShadow: "0 4px 20px rgba(120,60,255,0.5)" }}>
                Reload Page
              </button>
            </div>
          </Glass>
        </div>
      )}
    </div>
  );
}

function hexRgb(hex: string) {
  return `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;
}
