import { useEffect, useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { FolderSelect } from '../folders/FolderPicker';
import type { Folder, Project, Workflow } from '../../types';

/** Create or edit a project (name + description). */
export function ProjectFormDialog({ project, onClose, onSave }: { project: Project | null; onClose: () => void; onSave: (name: string, description: string) => void }) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  useEffect(() => { setName(project?.name ?? ''); setDescription(project?.description ?? ''); }, [project]);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{project ? 'Edit project' : 'New project'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField autoFocus size="small" label="Project name" placeholder="e.g. Savings Wallet, HelloBank, Payments" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim(), description.trim()); }} />
          <TextField size="small" label="Description (optional)" multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            helperText="The application, product or business domain this project covers" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!name.trim()} onClick={() => onSave(name.trim(), description.trim())}>{project ? 'Save' : 'Create project'}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** An empty project is simply deleted; a project with content needs a project to move that content to. Nothing is deleted with it. */
export function DeleteProjectDialog({ project, others, onClose, onConfirm }: { project: Project; others: Project[]; onClose: () => void; onConfirm: (moveTo?: number) => void }) {
  const empty = project.folderCount === 0 && project.workflowCount === 0;
  const [target, setTarget] = useState<number | ''>(others[0]?.id ?? '');
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete project "{project.name}"?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {empty
            ? <Typography>This project is empty. It will be deleted.</Typography>
            : (
              <>
                <Alert severity="warning">
                  It contains {project.workflowCount} workflow{project.workflowCount === 1 ? '' : 's'} and {project.folderCount} folder{project.folderCount === 1 ? '' : 's'}.
                  Nothing is deleted with it: they move to the project you choose, keeping their ids, configuration and run history.
                </Alert>
                {others.length === 0
                  ? <Alert severity="error">There is no other project to move them to. Create one first.</Alert>
                  : (
                    <TextField size="small" select label="Move contents to" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                      {others.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                    </TextField>
                  )}
              </>
            )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" disabled={!empty && target === ''} onClick={() => onConfirm(empty ? undefined : Number(target))}>
          {empty ? 'Delete project' : 'Move contents and delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Deleting a folder removes the folder structure only: its workflows are kept and move to the top level of the project. */
export function DeleteFolderDialog({ folder, workflowCount, subfolderCount, projectName, onClose, onConfirm }: {
  folder: Folder; workflowCount: number; subfolderCount: number; projectName: string; onClose: () => void; onConfirm: () => void;
}) {
  const [ack, setAck] = useState(false);
  const needsAck = workflowCount > 0;
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete folder "{folder.name}"?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {needsAck
            ? (
              <Alert severity="warning">
                This folder contains <b>{workflowCount} workflow{workflowCount === 1 ? '' : 's'}</b>{subfolderCount ? ` in ${subfolderCount} subfolder${subfolderCount === 1 ? '' : 's'}` : ''}.
                The folder{subfolderCount ? ' and its subfolders are' : ' is'} deleted; the workflows are <b>not</b>: they move to the top level of {projectName}.
              </Alert>
            )
            : <Typography>{subfolderCount ? `This folder and its ${subfolderCount} empty subfolder${subfolderCount === 1 ? '' : 's'} will be deleted.` : 'This empty folder will be deleted.'}</Typography>}
          {needsAck && <FormControlLabel control={<Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />} label="I understand, delete the folder" />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" disabled={needsAck && !ack} onClick={onConfirm}>Delete folder</Button>
      </DialogActions>
    </Dialog>
  );
}

export function DeleteWorkflowDialog({ workflow, onClose, onConfirm }: { workflow: Workflow; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete workflow "{workflow.name}"?</DialogTitle>
      <DialogContent><Typography>Its steps and configuration are deleted. Past run history is kept. This cannot be undone.</Typography></DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button color="error" variant="contained" onClick={onConfirm}>Delete workflow</Button></DialogActions>
    </Dialog>
  );
}

/** Move a workflow to a folder of its project, or to another project. */
export function MoveWorkflowDialog({ workflow, projects, folders, onClose, onMove }: {
  workflow: Workflow; projects: Project[]; folders: Folder[]; onClose: () => void; onMove: (projectId: number, folderId: number) => void;
}) {
  const [project, setProject] = useState<number>(workflow.projectId ?? projects[0]?.id ?? 0);
  const [folder, setFolder] = useState<number>(project === workflow.projectId ? workflow.folderId ?? 0 : 0);
  const same = project === (workflow.projectId ?? 0) && folder === (workflow.folderId ?? 0);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Move "{workflow.name}"</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField size="small" select label="Project" value={project} onChange={(e) => { setProject(Number(e.target.value)); setFolder(0); }}>
            {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          <FolderSelect folders={folders.filter((f) => f.projectId === project)} value={folder} onChange={setFolder} label="Folder" noneLabel="No folder (top level of the project)" />
          {project !== workflow.projectId && <Alert severity="info">Moving to another project keeps the workflow's id, steps and run history.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button variant="contained" disabled={same} onClick={() => onMove(project, folder)}>Move</Button></DialogActions>
    </Dialog>
  );
}
