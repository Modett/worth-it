import { parseRedisUrl } from './redis-options';

describe('parseRedisUrl', () => {
  it('parses host and default port from a bare URL', () => {
    expect(parseRedisUrl('redis://localhost')).toEqual({ host: 'localhost', port: 6379 });
  });

  it('parses explicit port and database index', () => {
    expect(parseRedisUrl('redis://cache.internal:6380/2')).toEqual({
      host: 'cache.internal',
      port: 6380,
      db: 2,
    });
  });

  it('parses credentials, decoding URL-escaped characters', () => {
    expect(parseRedisUrl('redis://default:p%40ss%3Aword@host:6379')).toEqual({
      host: 'host',
      port: 6379,
      username: 'default',
      password: 'p@ss:word',
    });
  });

  it('enables TLS for rediss:// URLs', () => {
    expect(parseRedisUrl('rediss://secure.example.com:6380')).toMatchObject({
      host: 'secure.example.com',
      port: 6380,
      tls: {},
    });
  });

  it('rejects a non-integer database index', () => {
    expect(() => parseRedisUrl('redis://localhost/notadb')).toThrow(/non-integer database index/);
  });
});
