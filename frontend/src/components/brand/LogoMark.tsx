import { useTheme } from '@mui/material';

interface Props { size?: number; title?: string }

/** FlowNexus mark: two source nodes (APIs) flowing into a database cylinder. Adapts to light/dark. */
export default function LogoMark({ size = 32, title = 'FlowNexus' }: Props) {
  const dark = useTheme().palette.mode === 'dark';
  const line = dark ? '#7FB0FF' : '#0A1F44';
  const node1 = dark ? '#FFFFFF' : '#0B3A6F';
  const id = dark ? 'fnGradDark' : 'fnGradLight';
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title} focusable="false">
      <title>{title}</title>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1E6BFF" /><stop offset="1" stopColor="#00D4FF" />
        </linearGradient>
      </defs>
      <path d="M12 20 C26 20 26 32 32 32 M12 44 C26 44 26 32 32 32 M32 32 H42" fill="none" stroke={line} strokeWidth="4" strokeLinecap="round" />
      <circle cx="12" cy="20" r="5" fill={node1} />
      <circle cx="12" cy="44" r="5" fill="#1E6BFF" />
      <ellipse cx="50" cy="31" rx="9" ry="4" fill="#00D4FF" />
      <path d="M41 31v9c0 2.2 4 4 9 4s9-1.8 9-4v-9" fill={`url(#${id})`} />
      <ellipse cx="50" cy="31" rx="9" ry="4" fill="#00D4FF" />
    </svg>
  );
}
