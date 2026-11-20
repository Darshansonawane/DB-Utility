import { describe, expect, it } from 'vitest';
import type { ConnectionView, StatusView } from '../types';
import { NO_FILTERS, connState, filterConnections, groupConnections, matchesQuery, sortConnections } from '../components/connections/connectionFilters';
import { canonicalEnv, envLabel } from '../utils/environments';

const c = (o: Partial<ConnectionView> & { id: number; name: string }): ConnectionView => ({
  environment: 'QA', dbType: 'MYSQL', host: 'db.internal', port: 3306, username: 'app', ownerName: 'Darshan', tls: false, usesUri: false,
  passwordProtected: true, connected: false, active: false, ...o,
});
const list: ConnectionView[] = [
  c({ id: 1, name: 'Savings_Wallet', host: '10.111.111.145', username: 'darshan', environment: 'QA' }),
  c({ id: 2, name: 'Savings_Wallet_staging', host: '172.19.0.83', environment: 'STAGING', ownerName: 'Rahul' }),
  c({ id: 3, name: 'Customer_Data', dbType: 'MONGODB', host: 'mongo.dev', environment: 'DEV', port: 27017, connected: true, active: true }),
  c({ id: 4, name: 'Payments', host: 'pay.qa', environment: 'QA', username: 'payuser' }),
  c({ id: 5, name: 'accounts-10', dbType: 'MONGODB', environment: 'STAGING' }),
  c({ id: 6, name: 'accounts-2', dbType: 'MONGODB', environment: 'STAGING' }),
];
const idle = () => 'idle' as const;
const ids = (l: ConnectionView[]) => l.map((x) => x.id);

describe('environment naming', () => {
  it('maps UAT to Staging and Development to DEV, and labels them for people', () => {
    expect(canonicalEnv('UAT')).toBe('STAGING');
    expect(canonicalEnv('staging')).toBe('STAGING');
    expect(canonicalEnv('Development')).toBe('DEV');
    expect(envLabel('UAT')).toBe('Staging');
    expect(envLabel('STAGING')).toBe('Staging');
    expect(envLabel('DEV')).toBe('Development');
    expect(envLabel('QA')).toBe('QA');
  });
});

describe('search', () => {
  it('matches name, host, username, owner and environment, case-insensitively', () => {
    expect(ids(list.filter((x) => matchesQuery(x, 'wallet')))).toEqual([1, 2]);
    expect(ids(list.filter((x) => matchesQuery(x, '172.19')))).toEqual([2]);
    expect(ids(list.filter((x) => matchesQuery(x, 'PAYUSER')))).toEqual([4]);
    expect(ids(list.filter((x) => matchesQuery(x, 'rahul')))).toEqual([2]);
    expect(ids(list.filter((x) => matchesQuery(x, 'staging')))).toEqual([2, 5, 6]);
    expect(ids(list.filter((x) => matchesQuery(x, 'development')))).toEqual([3]);
    expect(ids(list.filter((x) => matchesQuery(x, 'mongodb')))).toEqual([3, 5, 6]);
  });
  it('requires every word to match, in any order', () => {
    expect(ids(list.filter((x) => matchesQuery(x, 'wallet rahul')))).toEqual([2]);
    expect(ids(list.filter((x) => matchesQuery(x, 'rahul qa wallet')))).toEqual([]);
    expect(ids(list.filter((x) => matchesQuery(x, '   ')))).toHaveLength(list.length);
  });
});

describe('filters work together', () => {
  it('combines type, environment, status and search', () => {
    expect(ids(filterConnections(list, { ...NO_FILTERS, type: 'MONGODB' }, idle))).toEqual([3, 5, 6]);
    expect(ids(filterConnections(list, { ...NO_FILTERS, env: 'STAGING' }, idle))).toEqual([2, 5, 6]);
    expect(ids(filterConnections(list, { ...NO_FILTERS, type: 'MONGODB', env: 'STAGING' }, idle))).toEqual([5, 6]);
    expect(ids(filterConnections(list, { ...NO_FILTERS, type: 'MONGODB', env: 'STAGING', query: '10' }, idle))).toEqual([5]);
    expect(ids(filterConnections(list, { ...NO_FILTERS, env: 'QA', query: 'zzz' }, idle))).toEqual([]);
  });
  it('filters by connected / idle / failed using each connection\'s own state', () => {
    const health: Record<number, StatusView> = { 3: { connected: false, message: 'Connection lost' } };
    const failed = new Set([4]);
    const stateOf = (x: ConnectionView) => connState(x, health[x.id], failed.has(x.id));
    expect(connState(list[2], health[3])).toBe('lost');
    expect(ids(filterConnections(list, { ...NO_FILTERS, status: 'CONNECTED' }, (x) => connState(x)))).toEqual([3]);
    expect(ids(filterConnections(list, { ...NO_FILTERS, status: 'FAILED' }, stateOf))).toEqual([3, 4]);
    expect(ids(filterConnections(list, { ...NO_FILTERS, status: 'IDLE' }, stateOf))).toEqual([1, 2, 5, 6]);
  });
});

describe('sorting and grouping', () => {
  it('sorts by name (natural order), recently added, type and environment', () => {
    expect(sortConnections(list, 'name').map((x) => x.name)).toEqual(['accounts-2', 'accounts-10', 'Customer_Data', 'Payments', 'Savings_Wallet', 'Savings_Wallet_staging']);
    expect(ids(sortConnections(list, 'recent'))).toEqual([6, 5, 4, 3, 2, 1]);
    expect(sortConnections(list, 'type').map((x) => x.dbType)).toEqual(['MONGODB', 'MONGODB', 'MONGODB', 'MYSQL', 'MYSQL', 'MYSQL']);
    expect(sortConnections(list, 'env').map((x) => envLabel(x.environment))).toEqual(['QA', 'QA', 'Staging', 'Staging', 'Staging', 'Development']);
  });
  it('groups by type or environment in a sensible order, and not at all', () => {
    const byType = groupConnections(sortConnections(list, 'name'), 'type');
    expect(byType.map((g) => `${g.label}:${g.items.length}`)).toEqual(['MySQL:3', 'MongoDB:3']);
    const byEnv = groupConnections(sortConnections(list, 'name'), 'env');
    expect(byEnv.map((g) => `${g.label}:${g.items.length}`)).toEqual(['QA:2', 'Staging:3', 'Development:1']);
    expect(groupConnections(list, 'none')).toHaveLength(1);
  });
  it('stays fast with a few hundred connections', () => {
    const many = Array.from({ length: 300 }, (_, i) => c({ id: i + 1, name: `conn-${i}`, host: `10.0.${i % 255}.${i % 200}`, environment: ['QA', 'STAGING', 'DEV'][i % 3], dbType: i % 2 ? 'MONGODB' : 'MYSQL' }));
    const t = performance.now();
    for (let k = 0; k < 20; k++) groupConnections(sortConnections(filterConnections(many, { ...NO_FILTERS, query: 'conn 10', type: 'MYSQL' }, idle), 'name'), 'env');
    expect(performance.now() - t).toBeLessThan(500);
  });
});
