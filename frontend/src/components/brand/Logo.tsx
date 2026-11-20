import { Box, Typography } from '@mui/material';
import LogoMark from './LogoMark';

interface Props { markSize?: number; fontSize?: number | string }

/** Horizontal lockup: mark + "FlowNexus" wordmark. */
export default function Logo({ markSize = 32, fontSize = '1.25rem' }: Props) {
  return (
    <Box role="img" aria-label="FlowNexus" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'text.primary' }}>
      <LogoMark size={markSize} title="" />
      <Typography component="span" aria-hidden sx={{ fontWeight: 800, fontSize, letterSpacing: '-0.02em', lineHeight: 1, color: 'inherit' }}>
        Flow<Box component="span" sx={{ color: '#1E6BFF' }}>Nexus</Box>
      </Typography>
    </Box>
  );
}
