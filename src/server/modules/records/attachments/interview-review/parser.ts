import { createHash } from 'node:crypto';
import { readPdfLayout } from './pdf-layout';
import { INTERVIEW_TEMPLATES, type InterviewTemplate } from './templates';
import type {
  InterviewReviewOptions,
  InterviewReviewResult,
  ParsedInterviewReview,
  PdfBox,
  PdfCircle,
  PdfLayoutPage,
  PdfRegion,
  PdfText,
  ReadField,
  InterviewPageText,
  Selection,
} from './types';

type Line = {
  page: number;
  text: string;
  box: PdfBox;
  spans: PdfText[];
  start: number;
  end: number;
};
type Anchor = { name: string; line: Line; index: number };
const compact = (text: string) => text.replace(/\s/g, '');
const centerY = (box: PdfBox) => (box[1] + box[3]) / 2;
const centerX = (box: PdfBox) => (box[0] + box[2]) / 2;
function union(boxes: readonly PdfBox[]): PdfBox {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}
function linesFor(page: PdfLayoutPage): Line[] {
  const lines: Line[] = [];
  for (const span of [...page.text].sort(
    (a, b) => centerY(a.box) - centerY(b.box) || a.box[0] - b.box[0],
  )) {
    let line = [...lines]
      .reverse()
      .find(
        (candidate) =>
          Math.abs(centerY(candidate.box) - centerY(span.box)) <= 2,
      );
    if (!line) {
      line = {
        page: page.page,
        text: '',
        box: span.box,
        spans: [],
        start: 0,
        end: 0,
      };
      lines.push(line);
    }
    line.spans.push(span);
    line.spans.sort((a, b) => a.box[0] - b.box[0]);
    line.text = line.spans.map((item) => item.text).join(' ');
    line.box = union(line.spans.map((item) => item.box));
  }
  let offset = 0;
  for (const line of lines) {
    line.start = offset;
    line.end = offset + line.text.length;
    offset = line.end + 1;
  }
  return lines;
}
function region(line: Line): PdfRegion {
  return {
    page: line.page,
    box: line.box,
    textRange: { start: line.start, end: line.end },
  };
}
function starts(line: Line, label: string): boolean {
  return compact(line.text)
    .replace(/^[*＊•·\d.、]+/, '')
    .startsWith(compact(label));
}
/** Labels naming the same field; each field appears once in a supported form. */
const fieldGroups = [
  ['面试时间'],
  ['面试类型'],
  ['面试官姓名', '面试官'],
  ['面试结果'],
  ['综合评价'],
  ['评价表名称'],
  ['规则版本'],
  ['候选人'],
];
const metadataLabels = [
  '面试时间',
  '面试类型',
  '面试官姓名',
  '面试官',
  '面试结果',
  '综合评价',
  '评价表名称',
  '规则版本',
  '候选人',
];
function rowLabel(line: Line, label: string): boolean {
  if (line.spans.some((span) => compact(span.text) === compact(label)))
    return true;
  const value = compact(line.text);
  return (
    value.startsWith(compact(label)) &&
    /^[：:1-5SABCDN]/.test(value.slice(compact(label).length))
  );
}
/** A field label is the whole label, then a colon or nothing; free text that merely begins with it is not. */
function labelLine(line: Line, label: string): boolean {
  const value = compact(line.text).replace(/^[*＊•·\d.、]+/, '');
  if (!value.startsWith(compact(label))) return false;
  const rest = value.slice(compact(label).length);
  return rest === '' || /^[：:]/.test(rest);
}
function hasRadios(line: Line, pages: PdfLayoutPage[]): boolean {
  const page = pages.find((item) => item.page === line.page);
  return (
    page?.circles.some(
      (circle) =>
        Math.abs(centerY(circle.box) - centerY(line.box)) <= 10 &&
        centerX(circle.box) > line.spans[0].box[0],
    ) ?? false
  );
}
function heading(line: Line): boolean {
  return (
    /^(明细评价|评价概览|概览评价)/.test(compact(line.text)) ||
    INTERVIEW_TEMPLATES.some(
      (template) => compact(line.text) === compact(template.name),
    )
  );
}
function stripLabel(text: string, label: string): string {
  const pattern = [...label]
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
  return text.replace(new RegExp(`^\\s*${pattern}\\s*[:：]?\\s*`), '').trim();
}
function field(
  lines: Line[],
  labels: string[],
  boundary: (index: number) => boolean,
  multiline = false,
): ReadField {
  const index = lines.findIndex((line) =>
    labels.some((label) => labelLine(line, label)),
  );
  if (index < 0) return null;
  const label = labels.find((value) => labelLine(lines[index], value))!;
  const first = stripLabel(lines[index].text, label);
  const values: string[] = first ? [first] : [];
  const sources: PdfRegion[] = first ? [region(lines[index])] : [];
  for (
    let i = index + 1;
    i < lines.length && (multiline || values.length === 0);
    i++
  ) {
    if (heading(lines[i]) || boundary(i)) break;
    values.push(lines[i].text.trim());
    sources.push(region(lines[i]));
    if (!multiline) break;
  }
  return values.length ? { value: values.join('\n'), sources } : null;
}
function candidateName(lines: Line[]): ReadField {
  const candidates = lines.filter((line) =>
    /^候\s*选\s*人\s*[:：]/.test(line.text),
  );
  if (!candidates.length) return null;
  const values = candidates
    .map((line) => field([line], ['候选人'], () => true))
    .filter((value): value is NonNullable<ReadField> => value !== null);
  if (
    values.length !== candidates.length ||
    new Set(values.map((value) => value.value)).size !== 1
  )
    return null;
  return {
    value: values[0].value,
    sources: values.flatMap((value) => value.sources),
  };
}
function templateTitle(line: Line): string | null {
  if (starts(line, '评价表名称')) return stripLabel(line.text, '评价表名称');
  const exact = INTERVIEW_TEMPLATES.find(
    (template) => compact(line.text) === compact(template.name),
  );
  return (
    exact?.name ??
    (/评价表/.test(line.text) &&
    line.box[3] - line.box[1] >= 14 &&
    line.text.length < 80 &&
    !/[：:]/.test(line.text)
      ? line.text.trim()
      : null)
  );
}
function circleGroups(
  circles: PdfCircle[],
): { box: PdfBox; selected: boolean; supported: boolean }[] {
  const groups: PdfCircle[][] = [];
  for (const circle of circles) {
    const group = groups.find(
      (items) =>
        Math.abs(centerX(items[0].box) - centerX(circle.box)) <= 1 &&
        Math.abs(centerY(items[0].box) - centerY(circle.box)) <= 1,
    );
    if (group) group.push(circle);
    else groups.push([circle]);
  }
  return groups
    .map((group) => {
      let blue: PdfCircle[] = [];
      for (const paint of group) {
        if (paint.filled && paint.color !== 'blue')
          blue = blue.filter(
            (old) =>
              !(
                paint.box[0] <= old.box[0] &&
                paint.box[1] <= old.box[1] &&
                paint.box[2] >= old.box[2] &&
                paint.box[3] >= old.box[3]
              ),
          );
        if (paint.color === 'blue') blue.push(paint);
      }
      return {
        box: union(group.map((paint) => paint.box)),
        selected: blue.length > 0,
        supported: group.every(
          (paint) => paint.supported && paint.color !== 'other',
        ),
      };
    })
    .sort((a, b) => a.box[0] - b.box[0]);
}
function readSelection(
  anchor: Anchor,
  next: Anchor | undefined,
  lines: Line[],
  pages: PdfLayoutPage[],
  options: readonly string[],
): Selection {
  const rowLines = lines
    .slice(anchor.index, next?.index)
    .filter((line) => line.page === anchor.line.page);
  const bottom =
    next?.line.page === anchor.line.page
      ? next.line.box[1] - 2
      : pages.find((page) => page.page === anchor.line.page)!.height;
  const circles = pages
    .find((page) => page.page === anchor.line.page)!
    .circles.filter(
      (circle) =>
        centerY(circle.box) >= anchor.line.box[1] - 3 &&
        centerY(circle.box) < bottom &&
        centerX(circle.box) > anchor.line.spans[0].box[0],
    );
  const groups = circleGroups(circles);
  const source = {
    page: anchor.line.page,
    box: union([anchor.line.box, ...groups.map((group) => group.box)]),
    textRange: { start: anchor.line.start, end: anchor.line.end },
  };
  const fail = (
    reason: Extract<Selection, { status: 'unrecognized' }>['reason'],
  ): Selection => ({ status: 'unrecognized', reason, source });
  if (groups.length === 0) return fail('missing_selection');
  if (groups.some((group) => !group.supported))
    return fail('unsupported_graphics');
  const escaped = options
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|');
  const optionLines = rowLines.filter((line) =>
    groups.some(
      (group) => Math.abs(centerY(group.box) - centerY(line.box)) <= 10,
    ),
  );
  const citedLines = [anchor.line, ...optionLines];
  source.textRange = {
    start: Math.min(...citedLines.map((line) => line.start)),
    end: Math.max(...citedLines.map((line) => line.end)),
  };
  const tokens = (line: Line) =>
    [
      ...(starts(line, anchor.name)
        ? stripLabel(line.text, anchor.name)
        : line.text
      ).matchAll(
        new RegExp(`(?<![A-Za-z0-9])(${escaped})(?![A-Za-z0-9])`, 'g'),
      ),
    ].map((match) => match[1]);
  // Pair circles with labels row by row: each circle row must align with exactly one line of
  // option labels holding the same number of labels, so reading order is the same for both.
  const circleRows: (typeof groups)[] = [];
  for (const group of [...groups].sort(
    (a, b) => centerY(a.box) - centerY(b.box) || a.box[0] - b.box[0],
  )) {
    const row = circleRows.find(
      (items) => Math.abs(centerY(items[0].box) - centerY(group.box)) <= 3,
    );
    if (row) row.push(group);
    else circleRows.push([group]);
  }
  const labelled = optionLines.filter((line) => tokens(line).length > 0);
  const aligned = circleRows.map((row) =>
    labelled.filter(
      (line) => Math.abs(centerY(row[0].box) - centerY(line.box)) <= 10,
    ),
  );
  const ordered = circleRows.flatMap((row) =>
    [...row].sort((a, b) => a.box[0] - b.box[0]),
  );
  const found = aligned.flatMap((items) => items.flatMap(tokens));
  if (
    aligned.some(
      (items, index) =>
        items.length !== 1 ||
        tokens(items[0]).length !== circleRows[index].length,
    ) ||
    new Set(aligned.map((items) => items[0])).size !== aligned.length ||
    labelled.some((line) => !aligned.some((items) => items[0] === line)) ||
    ordered.length !== options.length ||
    found.join('|') !== options.join('|')
  )
    return fail('options_mismatch');
  // Then pair each circle with the one option label printed just to its right on the same
  // line. A circle with no such label, two candidates, or a label used twice is a layout we
  // cannot read with certainty, so nothing is read.
  const paired: string[] = [];
  for (const [index, row] of circleRows.entries()) {
    const labels: { token: string; box: PdfBox }[] = [];
    for (const span of aligned[index]![0]!.spans) {
      const text = starts(
        { ...aligned[index]![0]!, text: span.text, spans: [span] },
        anchor.name,
      )
        ? stripLabel(span.text, anchor.name)
        : span.text;
      const inSpan = [
        ...text.matchAll(
          new RegExp(`(?<![A-Za-z0-9])(${escaped})(?![A-Za-z0-9])`, 'g'),
        ),
      ].map((match) => match[1]!);
      if (inSpan.length > 1) return fail('options_mismatch');
      if (inSpan.length === 1)
        labels.push({ token: inSpan[0]!, box: span.box });
    }
    const used = new Set<number>();
    for (const group of [...row].sort((a, b) => a.box[0] - b.box[0])) {
      const near = labels.flatMap((label, at) =>
        label.box[0] >= group.box[2] - 2 && label.box[0] <= group.box[2] + 20
          ? [at]
          : [],
      );
      if (near.length !== 1 || used.has(near[0]!))
        return fail('options_mismatch');
      used.add(near[0]!);
      paired.push(labels[near[0]!]!.token);
    }
  }
  if (paired.join('|') !== options.join('|')) return fail('options_mismatch');
  const page = pages.find((item) => item.page === anchor.line.page)!;
  // Text painted over a circle can hide or fake a selection.
  if (
    groups.some((group) =>
      page.text.some(
        (span) =>
          span.box[0] < group.box[2] &&
          group.box[0] < span.box[2] &&
          span.box[1] < group.box[3] &&
          group.box[1] < span.box[3],
      ),
    )
  )
    return fail('unsupported_graphics');
  const selected = ordered.filter((group) => group.selected);
  if (selected.length === 0) return fail('missing_selection');
  if (selected.length !== 1) return fail('multiple_selections');
  return {
    status: 'recognized',
    value: paired[ordered.indexOf(selected[0])]!,
    source: {
      page: anchor.line.page,
      box: selected[0].box,
      textRange: source.textRange,
    },
  };
}

function parseSection(
  template: InterviewTemplate,
  title: Line,
  lines: Line[],
  pages: PdfLayoutPage[],
  options: InterviewReviewOptions,
): ParsedInterviewReview | null {
  const labels = [
    ...template.dimensions,
    template.rating.label,
    template.level.label,
  ];
  const metadataLine = (line: Line) =>
    metadataLabels.some((label) => labelLine(line, label));
  // A field label seen more than once (for example a comment line written as
  // 「候选人：…」) leaves the field and the comment boundary uncertain: neither is read.
  const repeated = new Set(
    fieldGroups.filter(
      (group) =>
        lines.filter((line) => group.some((label) => labelLine(line, label)))
          .length > 1,
    ),
  );
  const uncertain = (label: string) =>
    [...repeated].some((group) => group.includes(label));
  const choiceRow = (line: Line) =>
    [...line.text.matchAll(/(?<![A-Za-z0-9])([1-5])(?![A-Za-z0-9])/g)]
      .map((match) => match[1])
      .join('') === '12345';
  // The free-text comment runs until the next field label, standalone scale label, radio or
  // choice row, or heading. Its lines are never scale rows, whatever words they begin with.
  const comment = new Set<number>();
  let commentUncertain = uncertain('综合评价');
  const commentStart = lines.findIndex((line) => labelLine(line, '综合评价'));
  if (commentStart >= 0)
    for (let index = commentStart + 1; index < lines.length; index++) {
      const line = lines[index];
      if (
        heading(line) ||
        metadataLine(line) ||
        hasRadios(line, pages) ||
        choiceRow(line) ||
        line.spans.some((span) =>
          labels.some((label) => compact(span.text) === compact(label)),
        )
      ) {
        if (
          metadataLabels.some(
            (label) => labelLine(line, label) && uncertain(label),
          )
        )
          commentUncertain = true;
        break;
      }
      comment.add(index);
    }
  const anchors: Anchor[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (comment.has(index)) continue;
    const name = labels.find((label) => rowLabel(lines[index], label));
    if (name) anchors.push({ name, line: lines[index], index });
  }
  // An exact dimension fingerprint is required. A changed or duplicated row is a new template.
  if (
    template.dimensions.some(
      (name) => anchors.filter((anchor) => anchor.name === name).length !== 1,
    )
  )
    return null;
  for (let index = 0; index < lines.length; index++) {
    if (comment.has(index)) continue;
    const line = lines[index];
    if (!choiceRow(line)) continue;
    const row = template.dimensions.some((name) => rowLabel(line, name))
      ? line
      : lines[index - 1];
    if (
      !row ||
      row.page !== line.page ||
      Math.abs(centerY(row.box) - centerY(line.box)) > 15 ||
      !template.dimensions.some((name) => rowLabel(row, name))
    )
      return null;
  }
  const fieldEnd = (index: number) =>
    metadataLine(lines[index]) ||
    labels.some((label) => rowLabel(lines[index], label));
  const commentEnd = (index: number) => !comment.has(index);
  const selection = (label: string, choices: readonly string[]): Selection => {
    const anchor = anchors.find((item) => item.name === label);
    return anchor
      ? readSelection(
          anchor,
          anchors[anchors.indexOf(anchor) + 1],
          lines,
          pages,
          choices,
        )
      : {
          status: 'unrecognized',
          reason: 'options_mismatch',
          source: region(title),
        };
  };
  return {
    template: template.name,
    templateFingerprint: 'bow-896-synthetic-v1',
    demo: true,
    templateSource: region(title),
    identity: {
      candidateName: candidateName(lines),
      positionNumber: null, // No verified PDF label/fixture exists; never substitute another identifier.
    },
    metadata: {
      interviewTime: uncertain('面试时间')
        ? null
        : field(lines, ['面试时间'], fieldEnd),
      interviewType: uncertain('面试类型')
        ? null
        : field(lines, ['面试类型'], fieldEnd),
      interviewer: uncertain('面试官')
        ? null
        : field(lines, ['面试官姓名', '面试官'], fieldEnd),
      interviewResult: uncertain('面试结果')
        ? null
        : field(lines, ['面试结果'], fieldEnd),
      overallComment: commentUncertain
        ? null
        : field(lines, ['综合评价'], commentEnd, true),
    },
    dimensions: template.dimensions.map((name) => ({
      name,
      selection:
        name === '管理能力' && options.positionKind !== 'management'
          ? options.positionKind === 'non_management'
            ? { status: 'not_applicable', reason: 'non_management_position' }
            : {
                status: 'unrecognized',
                reason: 'applicability_unknown',
                source: region(
                  anchors.find((anchor) => anchor.name === name)!.line,
                ),
              }
          : selection(name, ['1', '2', '3', '4', '5']),
    })),
    interviewRating: selection(template.rating.label, template.rating.options),
    suggestedLevel: selection(template.level.label, template.level.options),
  };
}

export function parseInterviewReviewLayout(
  pages: PdfLayoutPage[],
  options: InterviewReviewOptions,
): InterviewReviewResult {
  const pageLinesByPage = pages.map((page) => ({
    page,
    lines: linesFor(page),
  }));
  const pageTexts: InterviewPageText[] = pageLinesByPage.map(
    ({ page, lines }) => {
      const text = lines.map((line) => line.text).join('\n');
      return {
        page: page.page,
        text,
        extractionVersion: 'interview-review-lines-v1',
        sha256: createHash('sha256').update(text).digest('hex'),
      };
    },
  );
  const lines = pageLinesByPage.flatMap(({ page, lines: allLines }) => {
    const pageLines = allLines.filter(
      (line) => line.box[1] >= 85 && line.box[3] < page.height - 45,
    );
    const overview = pageLines.some((line) =>
      /^(评价概览|概览评价|概览页|面试评价概览)/.test(compact(line.text)),
    );
    return overview &&
      !pageLines.some((line) => compact(line.text).startsWith('明细评价'))
      ? []
      : pageLines;
  });
  const titles: { line: Line; index: number; template: InterviewTemplate }[] =
    [];
  for (let index = 0; index < lines.length; index++) {
    const name = templateTitle(lines[index]);
    if (name === null) continue;
    const template = INTERVIEW_TEMPLATES.find(
      (item) => compact(item.name) === compact(name),
    );
    if (!template)
      return {
        status: 'rejected',
        reason: 'unknown_template',
        message: '评价表模板尚未支持，请交 HR 核对，不能猜测评分。',
        source: region(lines[index]),
      };
    const previous = titles.at(-1);
    const samePage = previous?.line.page === lines[index].page;
    const pageMetadata = lines
      .filter((line) => line.page === lines[index].page)
      .some((line) =>
        ['面试时间', '面试官', '面试官姓名'].some((label) =>
          starts(line, label),
        ),
      );
    if (previous?.template === template && !samePage && !pageMetadata) continue;
    if (previous?.template === template && samePage) continue;
    titles.push({ line: lines[index], index, template });
  }
  if (titles.length === 0)
    return {
      status: 'rejected',
      reason: 'no_detail_review',
      message:
        '没有找到支持的明细评价表，请提供「明细评价（整张评价表）」PDF。',
    };
  if (
    !options.allowSyntheticDemo ||
    titles.some(
      (title) =>
        !pages
          .find((page) => page.page === title.line.page)!
          .text.some((item) => compact(item.text).includes('化名演示')),
    )
  )
    return {
      status: 'rejected',
      reason: 'unverified_template_profile',
      message: '正式模板指纹尚待核对；合成演示样例必须明确启用且带有演示标记。',
    };
  const sectionStarts = titles.map((title, index) =>
    index === 0 || titles[index - 1].line.page !== title.line.page
      ? lines.findIndex((line) => line.page === title.line.page)
      : title.index,
  );
  const reviews: ParsedInterviewReview[] = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    // Interview metadata may precede the form title on its first page.
    const start = sectionStarts[i];
    const review = parseSection(
      title.template,
      title.line,
      lines.slice(start, sectionStarts[i + 1]),
      pages,
      options,
    );
    if (!review)
      return {
        status: 'rejected',
        reason: 'fingerprint_mismatch',
        message: '模板名称与维度指纹不一致，请交 HR 核对，不能猜测评分。',
        source: region(title.line),
      };
    reviews.push(review);
  }
  const manual = reviews.some(
    (review) =>
      Object.values(review.metadata).some((value) => value === null) ||
      [
        ...review.dimensions.map((dimension) => dimension.selection),
        review.interviewRating,
        review.suggestedLevel,
      ].some((selection) => selection.status === 'unrecognized'),
  );
  return {
    status: manual ? 'needs_manual_input' : 'parsed',
    reviews,
    pageTexts,
  };
}

export async function parseInterviewReviewPdf(
  bytes: Uint8Array,
  options: InterviewReviewOptions,
): Promise<InterviewReviewResult> {
  return parseInterviewReviewLayout(await readPdfLayout(bytes), options);
}
