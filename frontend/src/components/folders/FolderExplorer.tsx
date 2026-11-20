import { useMemo, useState } from 'react';
import {
  Alert, Box, Breadcrumbs, Button, IconButton, Link, Menu, MenuItem, Paper, Stack, Typography,
} from '@mui/material';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import FolderIcon from '@mui/icons-material/Folder';
import HomeIcon from '@mui/icons-material/Home';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { api, errMsg } from '../../services/api';
import type { Folder, FolderKind } from '../../types';
import FolderPicker from './FolderPicker';
import { NameDialog } from './FolderTree';
import { childrenOf, subtreeIds } from './folderUtils';

export const DRAG_TYPE = 'application/x-flownexus-item';

/**
 * File-explorer style folder browser: breadcrumb trail, the subfolders of the current folder as cards, drag an item onto a folder
 * card or a breadcrumb to move it. `directCounts` is the number of items directly inside each folder id (0 = top level).
 */
export default function FolderExplorer({ kind, folders, current, onNavigate, onChanged, directCounts, itemLabel, suggested, onDropItem }: {
  kind: FolderKind; folders: Folder[]; current: number; onNavigate: (id: number) => void; onChanged: () => void;
  directCounts: Record<number, number>; itemLabel: string; suggested?: string[]; onDropItem?: (itemId: number, folderId: number) => void;
}) {
  const [dialog, setDialog] = useState<null | { mode: 'new' | 'rename'; folder?: Folder }>(null);
  const [moving, setMoving] = useState<Folder | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; folder: Folder } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const trail: Folder[] = [];
  for (let id = current, guard = 0; id !== 0 && byId.has(id) && guard++ < 20; id = byId.get(id)!.parentId) trail.unshift(byId.get(id)!);
  const subfolders = childrenOf(folders, current);
  const total = (f: Folder) => [...subtreeIds(folders, f.id)].reduce((n, id) => n + (directCounts[id] ?? 0), 0);

  const act = async (fn: () => Promise<unknown>) => { try { await fn(); setError(null); onChanged(); } catch (e) { setError(errMsg(e)); } };
  const drop = (e: React.DragEvent, folderId: number) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData(DRAG_TYPE));
    if (id && onDropItem) onDropItem(id, folderId);
  };
  const dropProps = (folderId: number) => onDropItem ? {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(folderId); } },
    onDragLeave: () => setOver((o) => (o === folderId ? null : o)),
    onDrop: (e: React.DragEvent) => drop(e, folderId),
  } : {};

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="folder path" sx={{ flex: 1 }}>
          <Link component="button" underline="hover" color={current === 0 ? 'text.primary' : 'inherit'} onClick={() => onNavigate(0)} {...dropProps(0)}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: current === 0 ? 700 : 400, p: 0.5, borderRadius: 1, bgcolor: over === 0 ? 'action.selected' : undefined }}>
            <HomeIcon fontSize="small" /> All {itemLabel}
          </Link>
          {trail.map((f) => (
            <Link key={f.id} component="button" underline="hover" color={f.id === current ? 'text.primary' : 'inherit'} onClick={() => onNavigate(f.id)} {...dropProps(f.id)}
              sx={{ fontWeight: f.id === current ? 700 : 400, p: 0.5, borderRadius: 1, bgcolor: over === f.id ? 'action.selected' : undefined }}>{f.name}</Link>
          ))}
        </Breadcrumbs>
        <Button size="small" startIcon={<CreateNewFolderIcon />} onClick={() => setDialog({ mode: 'new' })}>New folder{current ? ' here' : ''}</Button>
        {current !== 0 && byId.get(current) && (
          <IconButton size="small" aria-label="folder actions" onClick={(e) => setMenu({ el: e.currentTarget, folder: byId.get(current)! })}><MoreVertIcon /></IconButton>
        )}
      </Stack>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {subfolders.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 1.5 }}>
          {subfolders.map((f) => {
            const kids = childrenOf(folders, f.id).length;
            const n = total(f);
            return (
              <Paper key={f.id} variant="outlined" {...dropProps(f.id)} onDoubleClick={() => onNavigate(f.id)}
                sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer', borderColor: over === f.id ? 'primary.main' : undefined, bgcolor: over === f.id ? 'action.hover' : undefined,
                  '&:hover': { bgcolor: 'action.hover' } }}
                onClick={() => onNavigate(f.id)} role="button" aria-label={`open folder ${f.name}`}>
                <FolderIcon sx={{ fontSize: 40, color: 'primary.main' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap fontWeight={600}>{f.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{n} {itemLabel}{kids ? ` · ${kids} folder${kids > 1 ? 's' : ''}` : ''}</Typography>
                </Box>
                <IconButton size="small" aria-label={`actions for ${f.name}`} onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, folder: f }); }}><MoreVertIcon fontSize="small" /></IconButton>
              </Paper>
            );
          })}
        </Box>
      )}
      {current === 0 && subfolders.length === 0 && suggested && suggested.length > 0 && (
        <Alert severity="info" action={<Button size="small" onClick={() => void act(async () => { for (const n of suggested) await api.createFolder(kind, 0, n); })}>Create them</Button>}>
          No folders yet. Create {suggested.map((n) => `"${n}"`).join(' and ')} to keep big flows and the small flows they are built from apart?
        </Alert>
      )}

      <Menu open={!!menu} anchorEl={menu?.el} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { const f = menu!.folder; setMenu(null); onNavigate(f.id); }}>Open</MenuItem>
        <MenuItem onClick={() => { const f = menu!.folder; setMenu(null); setDialog({ mode: 'rename', folder: f }); }}>Rename</MenuItem>
        <MenuItem onClick={() => { const f = menu!.folder; setMenu(null); setMoving(f); }}>Move to…</MenuItem>
        <MenuItem sx={{ color: 'error.main' }} onClick={() => {
          const f = menu!.folder; setMenu(null);
          if (window.confirm(`Delete folder "${f.name}" and its subfolders? The ${itemLabel} inside are not deleted: they move to the top level.`)) {
            void act(async () => { await api.deleteFolder(f.id); if (subtreeIds(folders, f.id).has(current)) onNavigate(byId.get(f.id)?.parentId ?? 0); });
          }
        }}>Delete</MenuItem>
      </Menu>
      {dialog?.mode === 'new' && <NameDialog title={current ? `New folder in ${byId.get(current)?.name}` : 'New folder'} initial="" onClose={() => setDialog(null)}
        onSave={(n) => { setDialog(null); void act(() => api.createFolder(kind, current, n)); }} />}
      {dialog?.mode === 'rename' && dialog.folder && <NameDialog title="Rename folder" initial={dialog.folder.name} onClose={() => setDialog(null)}
        onSave={(n) => { const f = dialog.folder!; setDialog(null); void act(() => api.updateFolder(f.id, { name: n })); }} />}
      {moving && <FolderPicker open title={`Move folder "${moving.name}" to…`} folders={folders} current={moving.parentId} disabled={subtreeIds(folders, moving.id)}
        onClose={() => setMoving(null)} onPick={(id) => { const f = moving; setMoving(null); void act(() => api.updateFolder(f.id, { parentId: id })); }} />}
    </Stack>
  );
}
