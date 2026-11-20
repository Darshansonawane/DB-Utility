import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, IconButton, InputAdornment, List, ListItemButton, ListItemText, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import SearchIcon from '@mui/icons-material/Search';
import { api, errMsg } from '../services/api';
import type { InfoItem, InfoSummary } from '../types';
import FolderTree, { useFolders } from '../components/folders/FolderTree';
import FolderPicker, { FolderSelect } from '../components/folders/FolderPicker';
import { ALL, folderPaths, inSelection } from '../components/folders/folderUtils';
import MarkdownLite from '../components/MarkdownLite';

/** All-in-One Information: one place for high-level notes on modules, features, APIs, database tables and workflows. */
export default function InfoHub() {
  const { folders, reload: reloadFolders } = useFolders('INFO');
  const [items, setItems] = useState<InfoSummary[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<number>(ALL);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [page, setPage] = useState<InfoItem | null>(null);
  const [draft, setDraft] = useState<InfoItem | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paths = useMemo(() => folderPaths(folders), [folders]);

  const load = useCallback(async () => {
    try { setItems(await api.infoItems(search.trim() || undefined)); setError(null); } catch (e) { setError(errMsg(e)); }
  }, [search]);
  useEffect(() => { const t = setTimeout(() => void load(), search ? 250 : 0); return () => clearTimeout(t); }, [load, search]);
  useEffect(() => {
    if (openId == null) { setPage(null); return; }
    api.infoItem(openId).then((p) => { setPage(p); setDraft(null); }).catch((e) => setError(errMsg(e)));
  }, [openId]);

  const counts = useMemo(() => {
    const c: Record<number, number> = { [ALL]: items.length, 0: 0 };
    for (const i of items) c[i.folderId] = (c[i.folderId] ?? 0) + 1;
    return c;
  }, [items]);
  const visible = items.filter((i) => inSelection(selectedFolder, i.folderId));

  const save = async () => {
    if (!draft) return;
    try {
      const saved = await api.saveInfoItem(draft);
      setDraft(null); setOpenId(saved.id!); setPage(saved); await load();
    } catch (e) { setError(errMsg(e)); }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="h5" fontWeight={700}>All-in-One Information</Typography>
      <Typography variant="body2" color="text.secondary">
        One place for high-level information about the application: business modules, features, APIs, database structures, workflows and runbooks. Organise pages in folders and subfolders; write in Markdown.
      </Typography>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="flex-start">
        <FolderTree title="Information" kind="INFO" folders={folders} selected={selectedFolder} onSelect={setSelectedFolder} onChanged={() => { reloadFolders(); void load(); }} counts={counts} itemLabel="pages" />
        <Paper variant="outlined" sx={{ width: { xs: '100%', lg: 320 }, flexShrink: 0 }}>
          <Stack direction="row" spacing={1} sx={{ p: 1 }}>
            <TextField size="small" fullWidth placeholder="Search all pages" value={search} onChange={(e) => setSearch(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
            <Tooltip title="New page"><IconButton color="primary" aria-label="new page" onClick={() => { setOpenId(null); setPage(null); setDraft({ folderId: selectedFolder > 0 ? selectedFolder : 0, title: '', content: '' }); }}><AddIcon /></IconButton></Tooltip>
          </Stack>
          <List dense disablePadding sx={{ maxHeight: 560, overflow: 'auto' }}>
            {visible.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>{search ? 'No page matches.' : 'No pages here yet.'}</Typography>}
            {visible.map((i) => (
              <ListItemButton key={i.id} selected={openId === i.id} onClick={() => setOpenId(i.id)}>
                <ListItemText primary={i.title} primaryTypographyProps={{ noWrap: true, fontWeight: openId === i.id ? 700 : 400 }}
                  secondary={<>{selectedFolder === ALL && i.folderId ? <Chip size="small" variant="outlined" label={paths.get(i.folderId)} sx={{ mr: 0.5, height: 18 }} /> : null}{i.snippet}</>}
                  secondaryTypographyProps={{ noWrap: true, component: 'div' }} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
        <Card variant="outlined" sx={{ flex: 1, minWidth: 0, width: '100%', p: 2 }}>
          {draft ? (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField size="small" fullWidth label="Title" required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus />
                <Box sx={{ minWidth: 240 }}><FolderSelect folders={folders} value={draft.folderId} onChange={(id) => setDraft({ ...draft, folderId: id })} /></Box>
              </Stack>
              <TextField multiline minRows={14} fullWidth label="Content (Markdown)" value={draft.content} spellCheck onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder={'# Module overview\n\nDescribe the module, its APIs and tables.\n\n| Table | Purpose |\n|---|---|\n| bank_wallet.savings_wallet_details | Savings pockets |'}
                slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }} />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={save} disabled={!draft.title.trim()}>Save page</Button>
                <Button onClick={() => { setDraft(null); }}>Cancel</Button>
              </Stack>
              {draft.content && <><Typography variant="subtitle2">Preview</Typography><Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}><MarkdownLite text={draft.content} /></Box></>}
            </Stack>
          ) : page ? (
            <>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>{page.title}</Typography>
                <Tooltip title="Edit"><IconButton aria-label="edit page" onClick={() => setDraft({ ...page })}><EditIcon /></IconButton></Tooltip>
                <Tooltip title="Move to folder"><IconButton aria-label="move page" onClick={() => setMoving(true)}><DriveFileMoveIcon /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton aria-label="delete page" onClick={async () => {
                  if (!window.confirm(`Delete "${page.title}"?`)) return;
                  try { await api.deleteInfoItem(page.id!); setOpenId(null); setPage(null); await load(); } catch (e) { setError(errMsg(e)); }
                }}><DeleteIcon /></IconButton></Tooltip>
              </Stack>
              <Typography variant="caption" color="text.secondary">{page.folderId ? paths.get(page.folderId) : 'Unfiled'}{page.updatedAt ? ` · updated ${new Date(page.updatedAt).toLocaleString()}` : ''}</Typography>
              <Box sx={{ mt: 1 }}>{page.content ? <MarkdownLite text={page.content} /> : <Typography variant="body2" color="text.secondary">This page is empty. Click Edit to add content.</Typography>}</Box>
            </>
          ) : (
            <Typography color="text.secondary">Select a page, or click + to create one.</Typography>
          )}
        </Card>
      </Stack>
      {moving && page && <FolderPicker open title={`Move "${page.title}" to…`} folders={folders} current={page.folderId} onClose={() => setMoving(false)}
        onPick={async (id) => { setMoving(false); try { await api.moveInfoItem(page.id!, id); setPage({ ...page, folderId: id }); await load(); } catch (e) { setError(errMsg(e)); } }} />}
    </Stack>
  );
}
