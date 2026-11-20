/** A small green checkmark that draws itself once (see .check-draw in styles/motion.css). */
export default function AnimatedCheck({ size = 16, color = 'currentColor', animate = true }: { size?: number; color?: string; animate?: boolean }) {
  return (
    <svg className={animate ? 'check-draw' : undefined} width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 10.5 8.5 14.5 15.5 6" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={animate ? undefined : { strokeDasharray: 'none' }} />
    </svg>
  );
}
