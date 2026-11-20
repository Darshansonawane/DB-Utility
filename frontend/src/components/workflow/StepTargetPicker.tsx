import { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Box, Chip, ListItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import StorageIcon from '@mui/icons-material/Storage';
import ApiIcon from '@mui/icons-material/Api';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

export type TargetType = 'QUERY' | 'API_REQUEST' | 'WORKFLOW';
export type TargetFilter = 'ALL' | TargetType;

/** Anything a workflow step can run: a database query, an API request or another workflow. */
export interface TargetItem {
  type: TargetType;
  id: number;
  name: string;
  description?: string | null;
  /** extra searchable text: category, HTTP method + URL, folder path... */
  meta?: string | null;
}

export const TYPE_LABEL: Record<TargetType, string> = { QUERY: 'DB Query', API_REQUEST: 'API Request', WORKFLOW: 'Workflow' };
const PLURAL: Record<TargetType, string> = { QUERY: 'DB queries', API_REQUEST: 'API requests', WORKFLOW: 'workflows' };
const MAX_SHOWN = 100;
const MORE_ID = -1;
const ICON: Record<TargetType, JSX.Element> = { QUERY: <StorageIcon fontSize="inherit" />, API_REQUEST: <ApiIcon fontSize="inherit" />, WORKFLOW: <AccountTreeIcon fontSize="inherit" /> };

/** Pure search used by the picker: every word must appear in the name, description, id or extra text (case-insensitive). */
export function searchTargets(items: TargetItem[], filter: TargetFilter, query: string): TargetItem[] {
  const tokens = query.toLowerCase().replace(/#/g, ' ').split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (filter !== 'ALL' && it.type !== filter) return false;
    if (tokens.length === 0) return true;
    const hay = `${it.name} ${it.description ?? ''} ${it.id} ${it.meta ?? ''} ${TYPE_LABEL[it.type]}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

interface Props {
  /** the type of the step being edited: the filter starts there and follows it when the step type changes */
  stepType: TargetType;
  /** the currently chosen target of the step, if any */
  value: { type: TargetType; id: number } | null;
  items: TargetItem[];
  /** picking an item of another type switches the step to that type; clearing resets the target of the current type */
  onPick: (item: TargetItem | null) => void;
}

/**
 * Searchable selector for a step's query / API request / workflow. Instant search (name, description, id, category, method, URL),
 * keyboard navigation, a type filter, and a capped list so thousands of items stay fast.
 */
export default function StepTargetPicker({ stepType, value, items, onPick }: Props) {
  const [filter, setFilter] = useState<TargetFilter>(stepType);
  useEffect(() => { setFilter(stepType); }, [stepType]);

  const counts = useMemo(() => {
    const c: Record<TargetFilter, number> = { ALL: items.length, QUERY: 0, API_REQUEST: 0, WORKFLOW: 0 };
    for (const it of items) c[it.type] += 1;
    return c;
  }, [items]);

  const selected = useMemo(() => (value ? items.find((it) => it.type === value.type && it.id === value.id) ?? null : null), [items, value]);
  const label = filter === 'ALL' ? 'Search queries, API requests and workflows' : `Search ${PLURAL[filter]}`;

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <ToggleButtonGroup size="small" exclusive value={filter} aria-label="filter by item type" onChange={(_, v: TargetFilter | null) => v && setFilter(v)}>
          <ToggleButton value="ALL">All ({counts.ALL})</ToggleButton>
          <ToggleButton value="QUERY">DB Query ({counts.QUERY})</ToggleButton>
          <ToggleButton value="API_REQUEST">API Request ({counts.API_REQUEST})</ToggleButton>
          <ToggleButton value="WORKFLOW">Workflow ({counts.WORKFLOW})</ToggleButton>
        </ToggleButtonGroup>
        {filter !== 'ALL' && filter !== stepType && (
          <Typography variant="caption" color="warning.main">Picking a {TYPE_LABEL[filter].toLowerCase()} turns this step into a {TYPE_LABEL[filter].toLowerCase()} step.</Typography>
        )}
      </Stack>
      <Autocomplete<TargetItem, false, false, false>
        size="small" fullWidth autoHighlight openOnFocus handleHomeEndKeys clearOnEscape
        options={items} value={selected}
        isOptionEqualToValue={(a, b) => a.type === b.type && a.id === b.id}
        getOptionLabel={(o) => o.name}
        getOptionDisabled={(o) => o.id === MORE_ID}
        groupBy={filter === 'ALL' ? (o) => (o.id === MORE_ID ? '' : TYPE_LABEL[o.type]) : undefined}
        filterOptions={(opts, { inputValue }) => {
          const hits = searchTargets(opts, filter, selected && inputValue === selected.name ? '' : inputValue);
          if (hits.length <= MAX_SHOWN) return hits;
          return [...hits.slice(0, MAX_SHOWN), { type: hits[0].type, id: MORE_ID, name: `Showing the first ${MAX_SHOWN} of ${hits.length} matches: keep typing to narrow` }];
        }}
        noOptionsText={filter === 'ALL' ? 'Nothing matches' : `No ${TYPE_LABEL[filter].toLowerCase()} matches`}
        onChange={(_, v) => onPick(v && v.id !== MORE_ID ? v : null)}
        ListboxProps={{ style: { maxHeight: 360 } }}
        slotProps={{ popper: { style: { minWidth: 460 } } }}
        renderInput={(p) => (
          <TextField {...p} label={label} placeholder="Type to search by name, description or id"
            InputProps={{ ...p.InputProps, startAdornment: <><SearchIcon fontSize="small" sx={{ mr: 0.5, color: 'text.disabled' }} />{p.InputProps.startAdornment}</> }} />
        )}
        renderOption={(props, o) => {
          if (o.id === MORE_ID) return <ListItem {...props} key="more" sx={{ fontStyle: 'italic', opacity: 0.8 }}>{o.name}</ListItem>;
          return (
            <ListItem {...props} key={`${o.type}-${o.id}`} data-testid={`target-${o.type}-${o.id}`} sx={{ alignItems: 'flex-start', gap: 1.25 }}>
              <Box sx={{ mt: 0.4, color: 'text.secondary', display: 'flex' }}>{ICON[o.type]}</Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{o.name}</Typography>
                {(o.description || o.meta) && <Typography variant="caption" color="text.secondary" noWrap component="div">{[o.meta, o.description].filter(Boolean).join(' · ')}</Typography>}
              </Box>
              {filter === 'ALL' && <Chip size="small" variant="outlined" label={TYPE_LABEL[o.type]} />}
              <Typography variant="caption" color="text.disabled">#{o.id}</Typography>
            </ListItem>
          );
        }}
      />
    </Stack>
  );
}
