import type { Person } from '@/contracts/person';
import { BlockState } from './BlockState';
import { projectWhen } from './person-view';

/** 参与的项目：只含有权读取的项目；项目详情路由上线前名称不做链接。 */
export function ProjectsCard({ projects }: { projects: Person['projects'] }) {
  return (
    <article className="n-card">
      <h3 className="n-section-title">参与的项目</h3>
      {projects.status === 'ready' ? (
        <ul className="n-members">
          {projects.data.map((project) => (
            <li key={project.id} className={project.to ? 'is-left' : undefined}>
              <span className="nt-plink">
                <b>{project.name}</b>
              </span>
              <span className="n-members__role">
                {project.role} · {project.mode}
              </span>
              <span className="n-members__when">{projectWhen(project)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <BlockState block={projects} empty="参与的项目会出现在这里" />
      )}
    </article>
  );
}
