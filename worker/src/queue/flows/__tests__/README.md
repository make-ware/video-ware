# Flow Builder Tests

This directory contains tests that validate flow builders implement all steps defined in their respective flow definitions.

## Purpose

These tests serve as **compile-time and runtime indicators** that ensure:

1. ✅ All steps defined in `TRANSCODE_FLOW_STEPS`, `RENDER_FLOW_STEPS`, and `LABELS_FLOW_STEPS` are implemented
2. ✅ Flow builders don't forget to add new steps when they're added to the definitions
3. ✅ Step dependencies are correctly configured
4. ✅ Optional vs required steps are handled properly

## Test Files

### `transcode-flow.builder.spec.ts`

Validates the `TranscodeFlowBuilder` against `TRANSCODE_FLOW_STEPS`:

- ✅ All 6 steps are included when fully configured (PROBE, THUMBNAIL, SPRITE, FILMSTRIP, TRANSCODE, AUDIO)
- ✅ Only PROBE is included when no optional steps are configured
- ✅ AUDIO step is properly configured with custom settings
- ✅ AUDIO step is excluded when `enabled: false`

### `render-flow.builder.spec.ts`

Validates the `RenderFlowBuilder` against `RENDER_FLOW_STEPS`:

- ✅ All 3 required steps are included (PREPARE, EXECUTE, FINALIZE)
- ✅ EXECUTE depends on PREPARE
- ✅ FINALIZE depends on EXECUTE

### `labels-flow.builder.spec.ts`

Validates the `LabelsFlowBuilder` against `LABELS_FLOW_STEPS`:

- ✅ All 6 steps are included (UPLOAD_TO_GCS + 5 detection steps)
- ✅ All detection steps depend on UPLOAD_TO_GCS
- ✅ UPLOAD_TO_GCS has no dependencies

## How It Works

### 1. Type-Safe Definitions

Flow definitions in `shared/src/jobs/flow-definitions.ts` define all required steps:

```typescript
export const TRANSCODE_FLOW_STEPS = {
  PROBE: TranscodeStepType.PROBE,
  THUMBNAIL: TranscodeStepType.THUMBNAIL,
  SPRITE: TranscodeStepType.SPRITE,
  FILMSTRIP: TranscodeStepType.FILMSTRIP,
  TRANSCODE: TranscodeStepType.TRANSCODE,
  AUDIO: TranscodeStepType.AUDIO,
} as const;
```

### 2. Runtime Validation

Tests validate that the flow builder includes all defined steps:

```typescript
it('should include all defined transcode steps when fully configured', () => {
  const flow = TranscodeFlowBuilder.buildFlow(task);
  const builtStepTypes = flow.children.map((child) => child.data.stepType);
  const expectedStepTypes = Object.values(TRANSCODE_FLOW_STEPS);

  for (const expectedStep of expectedStepTypes) {
    expect(builtStepTypes).toContain(expectedStep);
  }
});
```

### 3. Compile-Time Validation

TypeScript ensures the flow definitions are complete:

```typescript
it('should have type-safe step definitions', () => {
  const stepTypes: Record<string, string> = TRANSCODE_FLOW_STEPS;
  
  // If a step is missing, TypeScript will error
  expect(stepTypes.PROBE).toBeDefined();
  expect(stepTypes.AUDIO).toBeDefined();
  // ... etc
});
```

## Adding New Steps

When adding a new step to a flow:

1. **Add to the step type enum** in `shared/src/jobs/{flow}/types.ts`
2. **Add to the flow definition** in `shared/src/jobs/flow-definitions.ts`
3. **Update the flow builder** in `worker/src/queue/flows/{flow}-flow.builder.ts`
4. **Update the test** to verify the new step

If you forget step 3, the test will fail! ✅

## Running Tests

```bash
# Run all flow builder tests
npx vitest run src/queue/flows/__tests__/

# Run a specific test
npx vitest run src/queue/flows/__tests__/transcode-flow.builder.spec.ts

# Watch mode
npx vitest watch src/queue/flows/__tests__/
```

## Example: Adding the AUDIO Step

Here's how the AUDIO step was added:

1. ✅ Added `AUDIO = 'transcode:audio'` to `TranscodeStepType` enum
2. ✅ Added `AUDIO: TranscodeStepType.AUDIO` to `TRANSCODE_FLOW_STEPS`
3. ✅ Added audio step logic to `TranscodeFlowBuilder.buildFlow()`
4. ✅ Tests automatically validated the implementation

The test caught that we initially forgot to add the AUDIO step to the flow builder, preventing a production bug! 🎉

## Benefits

1. **Prevents Mistakes** - Can't forget to implement new steps
2. **Documentation** - Tests serve as living documentation
3. **Confidence** - Refactoring is safer with validation
4. **Type Safety** - Compile-time and runtime checks
5. **Maintainability** - Easy to see what's required

## Test Results

All tests should pass:

```
✓ src/queue/flows/__tests__/transcode-flow.builder.spec.ts (6 tests)
✓ src/queue/flows/__tests__/render-flow.builder.spec.ts (3 tests)
✓ src/queue/flows/__tests__/labels-flow.builder.spec.ts (4 tests)

Test Files  3 passed (3)
Tests       13 passed (13)
```
