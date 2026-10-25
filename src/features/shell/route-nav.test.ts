import { describe, expect, it } from 'vitest';
import type { ShellData } from '@/contracts/shell';
import { adminTitle, hrefPath, resolveRouteNav } from './route-nav';

const entry = (
  id: ShellData['navigation'][number]['id'],
  label: string,
  href: string,
): ShellData['navigation'][number] => ({
  id,
  label,
  href,
  icon: 'x',
  group: null,
});
const navigation = [
  entry('work', '工作台', '/work'),
  entry('people', '人才', '/people'),
  entry('projects', '项目与课题', '/projects'),
  entry('judge', '我的判断对照', '/judge?rater=me'),
];

describe('hrefPath', () => {
  it('drops query and hash', () => {
    expect(hrefPath('/judge?rater=me')).toBe('/judge');
    expect(hrefPath('/people#top')).toBe('/people');
    expect(hrefPath('/work')).toBe('/work');
  });
});

describe('resolveRouteNav', () => {
  it.each([
    ['/work', 'work', '工作台'],
    ['/people', 'people', '人才'],
    ['/projects', 'projects', '项目与课题'],
    ['/projects/p-1', 'projects', '项目与课题'],
    ['/judge', 'judge', '我的判断对照'],
  ])('%s is owned by %s', (pathname, currentId, title) => {
    expect(resolveRouteNav(navigation, pathname, false)).toEqual({
      currentId,
      title,
      parent: null,
    });
  });

  it('does not treat a longer sibling name as a child path', () => {
    expect(resolveRouteNav(navigation, '/projects-archive', false)).toEqual({
      currentId: null,
      title: null,
      parent: null,
    });
  });

  it('prefers the longest matching entry', () => {
    const nested = [
      entry('people', '人才', '/people'),
      entry('review', '盘点', '/people/review'),
    ];
    expect(resolveRouteNav(nested, '/people/review/x', false).currentId).toBe(
      'review',
    );
    expect(resolveRouteNav(nested, '/people/other', false).currentId).toBe(
      'people',
    );
  });

  it('puts the person page under the people entry with the fallback title', () => {
    expect(resolveRouteNav(navigation, '/person', false)).toEqual({
      currentId: 'people',
      title: '人员档案',
      parent: { label: '人才', href: '/people' },
    });
  });

  it('shows no parent link when the viewer has no people entry', () => {
    expect(
      resolveRouteNav(
        navigation.filter((item) => item.id !== 'people'),
        '/person',
        false,
      ),
    ).toEqual({ currentId: null, title: '人员档案', parent: null });
  });

  it('fixes the admin title and omits the parent link', () => {
    const admin = [entry('admin', '系统管理', '/admin')];
    expect(resolveRouteNav(admin, '/admin', true)).toEqual({
      currentId: 'admin',
      title: adminTitle,
      parent: null,
    });
    expect(resolveRouteNav(navigation, '/person', true)).toEqual({
      currentId: 'people',
      title: adminTitle,
      parent: null,
    });
  });

  it('matches nothing for an unknown path', () => {
    expect(resolveRouteNav(navigation, '/nowhere', false)).toEqual({
      currentId: null,
      title: null,
      parent: null,
    });
  });
});
