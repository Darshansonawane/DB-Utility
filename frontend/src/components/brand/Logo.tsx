import { Box, Typography } from '@mui/material';
import LogoMark from './LogoMark';
import { APP_NAME } from '../../brand';

interface Props { markSize?: number; fontSize?: number | string }

/** Horizontal lockup: mark + "HelloDB Hub" wordmark. */
export default function Logo({ markSize = 32, fontSize = '1.25rem' }: Props) {
  return (
    <Box role="img" aria-label={APP_NAME} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'text.primary' }}>
      <LogoMark size={markSize} title="" />
      <Typography component="span" aria-hidden sx={{ fontWeight: 800, fontSize, letterSpacing: '-0.02em', lineHeight: 1, color: 'inherit' }}>
        HelloDB <Box component="span" sx={{ color: '#E22042' }}>Hub</Box>
      </Typography>
    </Box>
  );
}
