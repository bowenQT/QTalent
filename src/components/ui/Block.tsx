import type { CSSProperties, ReactNode } from 'react';
import { Src } from './Src';

/**
 * A living-document block is either light (AI proposal, unsigned) or ink (a person
 * confirmed it and signed). The signature is required for ink, absent for light.
 */
export type BlockProps = { children: ReactNode; style?: CSSProperties } & (
  | {
      authorship: 'ai';
      /** What the draft rests on, e.g. 依据 2 条事件. */
      basis: string;
      label?: 'AI 建议' | 'AI 草拟';
    }
  | {
      authorship: 'human';
      signer: string;
      /** Role and confirmation date, e.g. 导师 · 10-21 确认. */
      meta: string;
    }
);

export function Block(props: BlockProps) {
  const { children, style } = props;
  const declared: string = props.authorship;
  if (declared !== 'ai' && declared !== 'human')
    throw new Error(`Unknown block authorship: ${declared}`);
  if (props.authorship === 'human') {
    // Ink means a person took responsibility; an unsigned block must stay light.
    if (!props.signer.trim())
      throw new Error('A human-confirmed block needs a signer');
    return (
      <div className="n-block" data-state="ink" style={style}>
        {children}
        <div className="n-block__by">
          <span className="n-block__sig">{props.signer}</span>
          {props.meta}
        </div>
      </div>
    );
  }
  return (
    <div className="n-block" data-state="light" style={style}>
      {children}
      <div className="n-block__by">
        <Src kind="ai" label={props.label} />
        {props.basis}
      </div>
    </div>
  );
}
