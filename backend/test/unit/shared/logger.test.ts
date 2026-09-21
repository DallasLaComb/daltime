import { describe, it, expect } from 'vitest';
import { serializeError } from '../../../src/functions/shared/logger.js';

describe('serializeError', () => {
  it('extracts name, message, and stack from an Error', () => {
    const err = new Error('something went wrong');
    const result = serializeError(err);
    expect(result['name']).toBe('Error');
    expect(result['message']).toBe('something went wrong');
    expect(typeof result['stack']).toBe('string');
  });

  it('preserves subclass name', () => {
    class CustomError extends Error {
      constructor() {
        super('custom');
        this.name = 'CustomError';
      }
    }
    const result = serializeError(new CustomError());
    expect(result['name']).toBe('CustomError');
  });

  it('falls back to string representation for non-Error values', () => {
    expect(serializeError('plain string')).toEqual({ error: 'plain string' });
    expect(serializeError(42)).toEqual({ error: '42' });
    expect(serializeError(null)).toEqual({ error: 'null' });
    expect(serializeError({ code: 500 })).toEqual({ error: '[object Object]' });
  });
});
