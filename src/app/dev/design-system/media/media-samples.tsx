'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DropZone } from '@/components/ui/DropZone';
import { FileList, type FileListEntry } from '@/components/ui/FileList';
import { TaskRow } from '@/components/ui/TaskRow';
import { Badge } from '@/components/ui/Badge';
import {
  formatBytes,
  type FileSelection,
  type FileSelectionRules,
} from '@/components/ui/file-selection';

// 样张的格式清单取本次范围（BOW-858）：用来试一试拖入与校验。说明文字按原型。
const rules: FileSelectionRules = {
  extensions: ['mp3', 'm4a', 'wav', 'aac', 'txt', 'docx', 'pdf'],
  acceptedLabel: 'MP3 / M4A / WAV / AAC / TXT / DOCX / PDF',
  maxBytes: 2 * 1024 ** 3,
  maxFiles: 10,
};

const materials: FileListEntry[] = [
  {
    id: 'docx',
    ext: 'DOCX',
    name: 'Landing W2 周报.docx',
    status: 'parsed',
    headline: '已解析',
    message: '12 段，定位到段落 · 提取 3 条事件待确认',
    action: <Button className="n-btn--sm">确认事件</Button>,
  },
  {
    id: 'xlsx',
    ext: 'XLSX',
    name: '实训营评审表.xlsx',
    status: 'parsed',
    headline: '已解析',
    message: '2 个工作表，定位到单元格 · 作为「训练营评审」导入，保留原量表',
    action: <Button className="n-btn--sm n-btn--ghost">查看</Button>,
  },
  {
    id: 'scan',
    ext: 'PDF',
    name: 'W2 评审意见（扫描）.pdf',
    status: 'parsed',
    headline: '已上传',
    message: '扫描件，未识别出文字，只作附件保存，不能定位到具体内容',
    action: <Button className="n-btn--sm n-btn--ghost">查看</Button>,
  },
  {
    id: 'mp4',
    ext: 'MP4',
    name: '客户现场演示录屏.mp4',
    status: 'parsed',
    headline: '已解析',
    message: '转写音轨 32 分钟，定位到时间点 · 不做画面理解',
    action: <Button className="n-btn--sm n-btn--ghost">查看</Button>,
  },
  {
    id: 'pptx',
    ext: 'PPTX',
    name: 'Milestone 述职.pptx',
    status: 'failed',
    headline: '读不出内容',
    message: '文件设置了打开密码。去掉密码后重新上传',
    action: <Button className="n-btn--sm n-btn--ghost">重新上传</Button>,
  },
];

const attachments: FileListEntry[] = [
  {
    id: 'pdf',
    ext: 'PDF',
    name: 'W3 对事复盘纪要.pdf',
    status: 'parsed',
    headline: '已解析',
    message: 'PDF · 293 KB · 可定位到页',
  },
  {
    id: 'm4a',
    ext: 'M4A',
    name: '导师访谈.m4a',
    status: 'processing',
    message: '转写中…',
  },
  {
    id: 'zip',
    ext: 'ZIP',
    name: '方案.zip',
    status: 'unsupported',
    message:
      '不支持 .zip 格式，可以上传 PDF、Word、PPT、Excel、TXT / MD、音频和视频',
  },
];

function describe({ accepted, rejected, overflow }: FileSelection) {
  return [
    ...(overflow ? [overflow.message] : []),
    ...rejected.map(({ file, message }) => `「${file.name}」${message}`),
    ...accepted.map(
      (file) => `「${file.name}」可以加入（${formatBytes(file.size)}）`,
    ),
  ];
}

export function MediaSamples() {
  const [files, setFiles] = useState(materials);
  const [attached, setAttached] = useState(attachments);
  const [notes, setNotes] = useState<string[]>([]);
  return (
    <div className="nt-grid" style={{ maxWidth: 680 }}>
      <section className="n-card">
        <h3 className="n-section-title">上传材料</h3>
        <div data-sample="drop">
          <DropZone
            rules={rules}
            currentCount={files.length}
            hint="PDF、Word、PPT、Excel、TXT / MD、音频和视频，可以一次拖入多个 · 单个不超过 2 GB · 会关联到「XEngineer 第六期」"
            onSelect={(selection) => setNotes(describe(selection))}
          />
        </div>
        <div data-sample="files">
          <FileList
            entries={files}
            onRemove={(id) => setFiles(files.filter((f) => f.id !== id))}
          />
        </div>
        {notes.length ? (
          <ul role="status" aria-label="选择结果" className="nt-muted">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="n-card">
        <h3 className="n-section-title">记录事件的附件</h3>
        <div data-sample="attach">
          <FileList
            variant="attach"
            entries={attached}
            onRemove={(id) => setAttached(attached.filter((f) => f.id !== id))}
          />
        </div>
        <h3 className="n-section-title">保存后只读</h3>
        <div data-sample="readonly">
          <FileList variant="attach" readOnly entries={attachments} />
        </div>
      </section>
      <section className="n-card">
        <h3 className="n-section-title">进行中的任务</h3>
        <div data-sample="tasks">
          <TaskRow
            state="uploading"
            name="W3 导师团复盘.m4a"
            note="182 MB 中的 113 MB · 上传时请保持页面打开"
            progress={62}
            canCancel
          />
          <TaskRow
            state="queued"
            name="客户转化组周会.m4a"
            note="10:42 提交 · 可以离开，结果会回到这里"
          />
          <TaskRow
            state="transcribing"
            name="W2 导师团复盘.m4a"
            badge={
              <Badge className="n-badge--preset">预先处理的演示任务</Badge>
            }
            note="正在区分说话人"
          />
          <TaskRow
            state="shaping"
            name="Landing W2 周报.docx"
            note="转写已完成，正在提取人员和事件"
            progress="none"
            actions={<Button className="n-btn--sm n-btn--ghost">看转写</Button>}
          />
          <TaskRow
            state="partial"
            name="W1 对事复盘.m4a"
            note="9 条事件已归档，2 处人名待确认"
            actions={<Button className="n-btn--sm">去核对</Button>}
          />
          <TaskRow
            state="done"
            name="实训营评审表.xlsx"
            note="新增 6 条训练营评审，涉及 6 人"
            actions={<Button className="n-btn--sm n-btn--ghost">查看</Button>}
          />
          <TaskRow
            state="failed"
            name="导师访谈.m4a"
            note="转写已保留，人员和事件提取没有完成"
            canRetry
          />
        </div>
      </section>
    </div>
  );
}
