import styles from './source-viewer.module.css';
import { locatedProps, type Locate } from './located';
import {
  cellPosition,
  columnName,
  sheetGrid,
  type At,
  type Content,
} from './viewer-model';

/** 表格按原表的行号和列字母排出来，引用的单元格用蓝框标出。 */
export function SheetOriginal({
  location,
  content,
  locate,
}: {
  location: At<'spreadsheet'>;
  content: Content<'spreadsheet'>;
  locate: Locate;
}) {
  const grid = sheetGrid(content.cells);
  // 工作表名对不上就不在这张表上标位置。
  const target =
    content.sheet === location.sheet ? cellPosition(location.cell) : null;
  return (
    <div className={styles.sheetWrap}>
      <table className={styles.sheet}>
        <caption>工作表「{content.sheet}」</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">行号</span>
            </th>
            {grid.columns.map((column) => (
              <th key={column} scope="col">
                {columnName(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              {grid.columns.map((column) => {
                const value = grid.text.get(`${row}:${column}`) ?? '';
                return target?.row === row && target.column === column ? (
                  <td key={column} {...locatedProps(locate)}>
                    {value}
                  </td>
                ) : (
                  <td key={column}>{value}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
