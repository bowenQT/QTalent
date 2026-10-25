import { describe, expect, it } from 'vitest';
import type { ShellData } from '@/contracts/shell';
import { ADMIN_TITLE, hrefPath, routeNav } from './route-nav';
const entry = (
  id: ShellData['navigation'][number]['id'],
  label: string,
  href: string,
) => ({ id, label, href, icon: id, group: null });
const navigation = [
  entry('work', '工作台', '/work'),
  entry('people', '人才', '/people'),
  entry('projects', '项目与课题', '/projects'),
  entry('judge', '我的判断对照', '/judge?rater=me'),
];
describe('navigation href path', () => {
  it('drops query and hash', () => {
    expect(hrefPath('/judge?rater=me')).toBe('/judge');
    expect(hrefPath('/rules#v3')).toBe('/rules');
    expect(hrefPath('/work')).toBe('/work');
  });
});
describe('current navigation entry', () => {
  it.each([
    ['/work', 'work', '工作台'],
    ['/people', 'people', '人才'],
    ['/projects', 'projects', '项目与课题'],
    ['/projects/p-1', 'projects', '项目与课题'],
    ['/judge', 'judge', '我的判断对照'],
  ] as const)('%s highlights %s', (pathname, active, title) => {
    expect(routeNav(navigation, pathname, false)).toEqual({
      active,
      parent: null,
      title,
    });
  });
  it('requires a path segment boundary', () => {
    expect(routeNav(navigation, '/worker', false)).toEqual({
      active: null,
      parent: null,
      title: null,
    });
  });
  it('prefers the longest matching navigation path', () => {
    const nested = [
      ...navigation,
      entry('programs', '人才项目', '/projects/programs'),
    ];
    expect(routeNav(nested, '/projects/programs/x', false).active).toBe(
      'programs',
    );
    expect(routeNav(nested, '/projects', false).active).toBe('projects');
  });
  it('uses the server-supplied label, such as the mentor people entry', () => {
    const mentor = navigation.map((item) =>
      item.id === 'people' ? { ...item, label: '所带学员' } : item,
    );
    expect(routeNav(mentor, '/people', false).title).toBe('所带学员');
  });
});
describe('alias routes', () => {
  it('maps the person page under people with a parent crumb and fallback title', () => {
    expect(routeNav(navigation, '/person', false)).toEqual({
      active: 'people',
      parent: { label: '人才', href: '/people' },
      title: '人员档案',
    });
  });
  it('keeps the fallback title without a parent when the entry is not authorized', () => {
    expect(routeNav(navigation.slice(0, 1), '/person', false)).toEqual({
      active: null,
      parent: null,
      title: '人员档案',
    });
  });
});
describe('administrator shell', () => {
  it('uses the fixed title and never shows a business parent crumb', () => {
    const admin = [entry('admin', '系统管理', '/admin')];
    expect(routeNav(admin, '/person', true)).toEqual({
      active: null,
      parent: null,
      title: ADMIN_TITLE,
    });
    expect(routeNav(admin, '/admin', true)).toEqual({
      active: 'admin',
      parent: null,
      title: ADMIN_TITLE,
    });
  });
});
