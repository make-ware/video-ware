/**
 * BullMQ Processor Base Classes
 *
 * Hierarchy:
 * - BaseProcessor: Foundation for all processors (task updates, error handling)
 * - BaseSimpleProcessor: For standalone jobs without parent-child relationships
 * - BaseFlowProcessor: For flow jobs with parent-child orchestration
 * - BaseParentProcessor: Legacy alias for BaseFlowProcessor (deprecated, use BaseFlowProcessor)
 */

export { BaseProcessor } from './base.processor';
export {
  BaseSimpleProcessor,
  type SimpleJobData,
} from './base-simple.processor';
export {
  BaseFlowProcessor,
  type TaskResult,
  type TaskErrorLogEntry,
} from './base-flow.processor';
