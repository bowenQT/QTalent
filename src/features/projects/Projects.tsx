'use client';
import { useRef, useState } from 'react';
import type { ProjectList } from '@/contracts/projects';
import { Icon } from '@/components/ui/Icon';
import { ProjectCard } from './ProjectCard';
import { NewProjectDialog } from './NewProjectDialog';
import { filterProjects } from './project-state';
export function Projects({
  data,
  mentor,
}: {
  data: ProjectList;
  mentor: boolean;
}) {
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const projects = filterProjects(data.projects, status);
  function close() {
    setCreating(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <>
      <header className="nt-head">
        <div>
          <h1>项目与课题</h1>
          <p>
            {mentor
              ? '你所带批次的课题，以及你参与的项目。'
              : '训练营课题、用人项目和黑客松。一个人可以同时在几个项目里，进出都留有记录。'}
          </p>
        </div>
        {data.canCreate ? (
          <div className="nt-head__acts">
            <a className="n-btn n-btn--sm" href="/staffing?new=1">
              <Icon name="spark" />
              为项目找人
            </a>
            <button
              ref={trigger}
              className="n-btn n-btn--sm n-btn--ink"
              type="button"
              onClick={() => {
                setNotice('');
                setCreating(true);
              }}
            >
              <Icon name="plus" />
              新建项目
            </button>
          </div>
        ) : null}
      </header>
      {notice ? (
        <p role="status" className="n-toast">
          {notice}
        </p>
      ) : null}
      <div className="n-chips" role="group" aria-label="按状态筛选">
        {['all', '筹备中', '进行中', '已结束', '已归档'].map((value) => (
          <button
            key={value}
            className="n-chip"
            type="button"
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          >
            {value === 'all' ? '全部' : value}
          </button>
        ))}
      </div>
      <div className="nt-cols" id="plist">
        {projects.length ? (
          projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              canFindOwner={data.canCreate}
            />
          ))
        ) : (
          <div className="nt-empty" style={{ gridColumn: '1/-1' }}>
            这个状态的项目会出现在这里。
          </div>
        )}
      </div>
      {creating ? (
        <NewProjectDialog
          people={data.eligiblePeople}
          onClose={close}
          onCreated={() => {
            setStatus('all');
            setNotice('项目已创建，已回到项目列表');
          }}
        />
      ) : null}
    </>
  );
}
