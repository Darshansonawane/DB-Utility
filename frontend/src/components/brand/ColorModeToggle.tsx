import { IconButton, Tooltip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import { useColorMode } from '../../theme/ColorMode';

const NEXT = { light: 'dark', dark: 'system', system: 'light' } as const;

export default function ColorModeToggle() {
  const { preference, cycle } = useColorMode();
  const label = `Theme: ${preference}. Switch to ${NEXT[preference]}`;
  return (
    <Tooltip title={label}>
      <IconButton color="inherit" onClick={cycle} aria-label={label} sx={{ mr: 1 }}>
        {preference === 'light' ? <LightModeIcon /> : preference === 'dark' ? <DarkModeIcon /> : <SettingsBrightnessIcon />}
      </IconButton>
    </Tooltip>
  );
}
