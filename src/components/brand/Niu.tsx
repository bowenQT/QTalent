'use client';
import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { brandSvg } from './brand-svg';
const labels = {
  rest: '小犇',
  listening: '小犇：倾听',
  searching: '小犇：检索',
  thinking: '小犇：思考',
  done: '小犇：完成',
  confirm: '小犇：需要你确认',
  error: '小犇：出错',
};
export function Niu({
  state = 'rest',
  size = 24,
}: {
  state?: keyof typeof labels;
  size?: number;
}) {
  const id = useId().replaceAll(':', '');
  const reduced = useReducedMotion();
  return (
    <motion.span
      className="ip"
      role="img"
      aria-label={labels[state]}
      data-state={state}
      data-size={size >= 48 ? 'l' : size >= 28 ? 'm' : 's'}
      style={{ width: size, height: size }}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.16 }}
      dangerouslySetInnerHTML={{ __html: brandSvg(id) }}
    />
  );
}
