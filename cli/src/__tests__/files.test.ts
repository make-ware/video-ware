import { describe, it, expect } from 'vitest';
import { FileType } from '@project/shared';
import {
  DERIVED_FILE_TYPES,
  assertDerivedFile,
  pbFileUrl,
} from '../lib/files.js';
import { fakePb } from './fake-pb.js';

describe('assertDerivedFile', () => {
  it('refuses the original upload', () => {
    expect(() =>
      assertDerivedFile({ id: 'f1', fileType: FileType.ORIGINAL })
    ).toThrow(/never the source upload/);
  });

  it('accepts every derived type', () => {
    for (const fileType of DERIVED_FILE_TYPES) {
      expect(() => assertDerivedFile({ id: 'f1', fileType })).not.toThrow();
    }
  });

  it('refuses a type nobody has opted in', () => {
    expect(() =>
      assertDerivedFile({ id: 'f1', fileType: 'something_new' as FileType })
    ).toThrow(/is fileType "something_new"/);
  });
});

describe('pbFileUrl', () => {
  const pb = fakePb({});

  it('builds a PocketBase file URL', () => {
    const url = pbFileUrl(pb, {
      id: 'f1',
      file: 'strip.jpg',
      fileSource: 'pocketbase',
    } as never);
    expect(url).toBe('http://pb.test/api/files/Files/f1/strip.jpg');
  });

  it('explains a file whose bytes live elsewhere', () => {
    expect(() =>
      pbFileUrl(pb, { id: 'f1', fileSource: 's3' } as never)
    ).toThrow(/not hosted in PocketBase \(fileSource "s3"\)/);
  });
});
