/**
 * Pure-function coverage for the label list: the per-type source registry that
 * replaces the old per-page copies of "which collection, which confidence
 * column, which fields are searchable", and the PocketBase filter built from
 * it — the one place user input reaches a query string.
 */
import { describe, it, expect } from 'vitest';
import { LabelType } from '@project/shared';
import { LABEL_TYPE_META } from '@project/shared/mutator';
import {
  LABEL_LIST_SOURCES,
  LABELS_PAGE_SIZE,
  NO_LABEL_FILTERS,
  activeEquals,
  buildLabelFilter,
  hasActiveLabelFilters,
  labelSource,
  type LabelListFilters,
} from '../use-label-list';

const ALL_TYPES = Object.values(LabelType);

function filters(overrides: Partial<LabelListFilters> = {}): LabelListFilters {
  return { ...NO_LABEL_FILTERS, ...overrides };
}

describe('LABEL_LIST_SOURCES', () => {
  it('covers every label type', () => {
    for (const type of ALL_TYPES) {
      expect(LABEL_LIST_SOURCES[type]).toBeDefined();
    }
  });

  it('takes its structural facts from the shared LABEL_TYPE_META', () => {
    for (const type of ALL_TYPES) {
      const source = labelSource(type);
      expect(source.collection).toBe(LABEL_TYPE_META[type].collection);
      expect(source.confidenceField).toBe(
        LABEL_TYPE_META[type].confidenceField
      );
    }
  });

  it('never expands LabelTrackRef on the trackless types', () => {
    for (const type of ALL_TYPES) {
      if (LABEL_TYPE_META[type].hasTrack) continue;
      expect(labelSource(type).expand).not.toContain('LabelTrackRef');
    }
  });

  it('pages every type through the same window', () => {
    for (const type of ALL_TYPES) {
      expect(labelSource(type).perPage).toBe(LABELS_PAGE_SIZE);
    }
  });

  it('sorts by start so pages read as a timeline', () => {
    for (const type of ALL_TYPES) {
      expect(labelSource(type).sort).toBe('start');
    }
  });
});

describe('buildLabelFilter', () => {
  const objects = labelSource(LabelType.OBJECT);

  it('scopes to the media and nothing else when no filter is set', () => {
    expect(buildLabelFilter(objects, 'media-1', filters())).toBe(
      "MediaRef = 'media-1'"
    );
  });

  it("adds the confidence clause on the type's own column", () => {
    expect(
      buildLabelFilter(objects, 'm', filters({ minConfidence: 0.85 }))
    ).toContain('confidence >= 0.85');
    // Faces store avgConfidence — the same UI control, a different column.
    expect(
      buildLabelFilter(
        labelSource(LabelType.FACE),
        'm',
        filters({ minConfidence: 0.5 })
      )
    ).toContain('avgConfidence >= 0.5');
  });

  it('drops the confidence and duration clauses at zero', () => {
    const filter = buildLabelFilter(
      objects,
      'm',
      filters({ minConfidence: 0, minDuration: 0 })
    );
    expect(filter).not.toContain('confidence');
    expect(filter).not.toContain('duration');
  });

  it('adds the duration clause in seconds', () => {
    expect(
      buildLabelFilter(objects, 'm', filters({ minDuration: 5 }))
    ).toContain('duration >= 5');
  });

  it("ORs the text query across the type's query fields", () => {
    const filter = buildLabelFilter(
      labelSource(LabelType.PERSON),
      'm',
      filters({ query: 'red' })
    );
    expect(filter).toContain(
      "(personId ~ 'red' || upperBodyColor ~ 'red' || lowerBodyColor ~ 'red')"
    );
  });

  it('ignores a query for a type with no searchable fields', () => {
    const searchless = { ...objects, queryFields: [] };
    expect(buildLabelFilter(searchless, 'm', filters({ query: 'red' }))).toBe(
      "MediaRef = 'm'"
    );
  });

  it('binds equals clauses and drops the empty ones', () => {
    const speaker = labelSource(LabelType.SPEAKER);
    expect(
      buildLabelFilter(speaker, 'm', filters({ equals: { speakerId: 'S2' } }))
    ).toContain("speakerId = 'S2'");
    expect(
      buildLabelFilter(speaker, 'm', filters({ equals: { speakerId: null } }))
    ).toBe("MediaRef = 'm'");
  });

  it('binds user input rather than interpolating it', () => {
    // A quote in the search box must not be able to close the string literal
    // and append a clause of its own.
    const filter = buildLabelFilter(
      objects,
      'm',
      filters({ query: "a' || id != '" })
    );
    expect(filter).toBe("MediaRef = 'm' && (entity ~ 'a\\' || id != \\'')");
  });

  it('joins every clause with AND', () => {
    const filter = buildLabelFilter(
      objects,
      'media-1',
      filters({ minConfidence: 0.7, minDuration: 2, query: 'dog' })
    );
    expect(filter).toBe(
      "MediaRef = 'media-1' && confidence >= 0.7 && duration >= 2 && (entity ~ 'dog')"
    );
  });
});

describe('hasActiveLabelFilters', () => {
  it('is false for the baseline', () => {
    expect(hasActiveLabelFilters(NO_LABEL_FILTERS)).toBe(false);
  });

  it('ignores whitespace-only queries', () => {
    expect(hasActiveLabelFilters(filters({ query: '   ' }))).toBe(false);
  });

  it('counts every clause kind', () => {
    expect(hasActiveLabelFilters(filters({ minConfidence: 0.5 }))).toBe(true);
    expect(hasActiveLabelFilters(filters({ minDuration: 1 }))).toBe(true);
    expect(hasActiveLabelFilters(filters({ query: 'x' }))).toBe(true);
    expect(
      hasActiveLabelFilters(filters({ equals: { speakerId: 'S1' } }))
    ).toBe(true);
    expect(
      hasActiveLabelFilters(filters({ equals: { speakerId: null } }))
    ).toBe(false);
  });
});

describe('activeEquals', () => {
  it('keeps only the set clauses, so the query key stays stable', () => {
    expect(
      activeEquals(filters({ equals: { speakerId: null, faceId: 'F1' } }))
    ).toEqual({ faceId: 'F1' });
    expect(activeEquals(filters())).toEqual({});
  });
});
