import { Fragment, type ReactNode } from 'react';
import { Box, Divider, Link, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

/** Inline: `code`, **bold**, *italic*, [text](https://…). Only http(s) links are made clickable. */
export function renderInline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${n++}`;
    if (m[1]) out.push(<Box component="code" key={key} sx={{ px: 0.5, borderRadius: 0.5, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.9em' }}>{tok.slice(1, -1)}</Box>);
    else if (m[2]) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(tok)!;
      out.push(<Link key={key} href={url} target="_blank" rel="noopener noreferrer">{label}</Link>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** A small, safe Markdown renderer (no HTML injection): headings, lists, quotes, code blocks, tables, rules, inline styles. */
export default function MarkdownLite({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(<Box key={k++} component="pre" sx={{ m: 0, my: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflow: 'auto', fontSize: 13, fontFamily: 'monospace' }}>{code.join('\n')}</Box>);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = /^#+/.exec(line)![0].length;
      blocks.push(<Typography key={k++} variant={(['h4', 'h5', 'h6', 'subtitle1', 'subtitle2', 'subtitle2'] as const)[level - 1]} fontWeight={700} sx={{ mt: 1.5, mb: 0.5 }}>{renderInline(line.replace(/^#+\s/, ''), `h${k}`)}</Typography>);
      i++;
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<Divider key={k++} sx={{ my: 1.5 }} />);
      i++;
    } else if (isTableLine(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <Box key={k++} sx={{ overflowX: 'auto', my: 1 }}>
          <Table size="small" sx={{ border: 1, borderColor: 'divider' }}>
            <TableHead><TableRow>{head.map((h, c) => <TableCell key={c} sx={{ fontWeight: 700 }}>{renderInline(h, `th${c}`)}</TableCell>)}</TableRow></TableHead>
            <TableBody>{rows.map((r, ri) => <TableRow key={ri}>{r.map((c, ci) => <TableCell key={ci}>{renderInline(c, `td${ri}-${ci}`)}</TableCell>)}</TableRow>)}</TableBody>
          </Table>
        </Box>,
      );
    } else if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: { indent: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])!;
        items.push({ indent: Math.floor(m[1].length / 2), ordered: /\d/.test(m[2]), text: m[3] });
        i++;
      }
      blocks.push(
        <Box key={k++} component="ul" sx={{ my: 0.5, pl: 3 }}>
          {items.map((it, ii) => <Box key={ii} component="li" sx={{ ml: it.indent * 2, listStyleType: it.ordered ? 'decimal' : 'disc' }}><Typography variant="body2" component="span">{renderInline(it.text, `li${ii}`)}</Typography></Box>)}
        </Box>,
      );
    } else if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<Box key={k++} sx={{ borderLeft: 3, borderColor: 'divider', pl: 1.5, my: 1, color: 'text.secondary' }}><Typography variant="body2">{renderInline(q.join(' '), `q${k}`)}</Typography></Box>);
    } else if (line.trim() === '') {
      i++;
    } else {
      const p: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,6}\s|>\s?|\s*([-*+]|\d+\.)\s+)/.test(lines[i]) && !(isTableLine(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]))) p.push(lines[i++]);
      blocks.push(<Typography key={k++} variant="body2" sx={{ my: 0.75, whiteSpace: 'pre-wrap' }}>{p.map((l, li) => <Fragment key={li}>{li > 0 && '\n'}{renderInline(l, `p${k}-${li}`)}</Fragment>)}</Typography>);
    }
  }
  return <Box>{blocks}</Box>;
}
