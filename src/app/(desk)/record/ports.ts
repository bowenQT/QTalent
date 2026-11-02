import type { RecordActions } from '@/features/record/types';
import { resolveRecordNodeAction } from '@/server/actions/record-batch';

/**
 * 评价节点推导（所有者裁决 #248 6564917769，BOW-845 #327）：按所选人员在服务端判断，
 * 返回唯一、多个或没有。页面只在唯一时提交，其余写明原因。
 */
export const resolveRecordNode: RecordActions['resolveNode'] = (input) =>
  resolveRecordNodeAction(input);
