import { logger } from './logger.js';

describe('logger', () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    logger.setOutput({
      write: (chunk: string) => {
        written.push(chunk);
        return true;
      },
    });
    logger.setLevel('debug');
  });

  it('writes formatted log entries to output stream', () => {
    logger.info('hello world');

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('INFO');
    expect(written[0]).toContain('hello world');
  });

  it('includes context as JSON when provided', () => {
    logger.info('test', { key: 'value' });

    expect(written[0]).toContain('{"key":"value"}');
  });

  it('respects log level filtering', () => {
    logger.setLevel('warn');

    logger.debug('debug msg');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');

    expect(written).toHaveLength(2);
    expect(written[0]).toContain('WARN');
    expect(written[1]).toContain('ERROR');
  });

  it('includes ISO timestamp in entries', () => {
    logger.info('test');

    const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    expect(written[0]).toMatch(isoPattern);
  });

  it('omits context field when not provided', () => {
    logger.info('no context');

    // Should end with message + newline, no trailing JSON
    expect(written[0]).toMatch(/no context\n$/);
  });
});
