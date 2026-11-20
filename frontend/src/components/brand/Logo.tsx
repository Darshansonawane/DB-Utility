import { Box, Typography } from '@mui/material';
import LogoMark from './LogoMark';

interface Props { markSize?: number; fontSize?: number | string }

/** Horizontal lockup: mark + "DB-Utility" wordmark. */
export default function Logo({ markSize = 32, fontSize = '1.25rem' }: Props) {
  return (
    <Box role="img" aria-label="DB-Utility" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'text.primary' }}>
      <LogoMark size={markSize} title="" />
      <Typography component="span" aria-hidden sx={{ fontWeight: 800, fontSize, letterSpacing: '-0.02em', lineHeight: 1, color: 'inherit' }}>
        DB-<Box component="span" sx={{ color: '#1E6BFF' }}>Utility</Box>
      </Typography>
    </Box>
  );
}
