import Editor, { loader } from '@monaco-editor/react';
import { useTheme } from '@mui/material';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// Bundle Monaco locally (no CDN calls: the laptop may only have VPN access to internal hosts).
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new editorWorker() };
loader.config({ monaco });

interface Props { value: string; onChange: (v: string) => void; height?: number | string; readOnly?: boolean; language?: 'sql' | 'json' }

export default function SqlEditorBox({ value, onChange, height = 260, readOnly, language = 'sql' }: Props) {
  const dark = useTheme().palette.mode === 'dark';
  return (
    <div style={{ border: `1px solid ${dark ? '#2b3f66' : '#cfd6e4'}`, borderRadius: 6, overflow: 'hidden' }}>
      <Editor
        height={height}
        language={language}
        theme={dark ? 'vs-dark' : 'light'}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on', readOnly, automaticLayout: true }}
      />
    </div>
  );
}
