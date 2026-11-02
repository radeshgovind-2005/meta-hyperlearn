type P = { size?: number; color?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true as const });

export const ArrowUp = ({ size = 18, color = "#FFFFFF" }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
export const Close = ({ size = 18, color = "#1C2B33" }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Mic = ({ size = 18, color = "#1C2B33" }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const Upload = ({ size = 28, color = "#0A5CFF" }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>
);
export const More = ({ size = 18, color = "#5B6B7A" }: P) => (
  <svg {...base(size)} fill={color}><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
);
export const Play = ({ size = 14, color = "#0A5CFF" }: P) => (
  <svg {...base(size)} fill={color}><path d="M7 4l13 8-13 8z" /></svg>
);
export const Pause = ({ size = 14, color = "#0A5CFF" }: P) => (
  <svg {...base(size)} fill={color}><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
);
export const Speaker = ({ size = 16, color = "#1C2B33" }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>
);
export const Chevron = ({ size = 14, color = "#1C2B33" }: P) => (
  <svg {...base(size)} stroke={color} strokeWidth="2" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
);
